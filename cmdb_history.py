#!/usr/bin/env python3
"""
CMDB History Manager v2 - Fixed reconnection handling
"""

import os
import json
import subprocess
from datetime import datetime
from typing import Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

CACHE_DIR = os.path.expanduser("~/.vmware-dashboard-cache")
CMDB_FILE = os.path.join(CACHE_DIR, "cmdb_history.json")

class HistoricalCMDB:
    def __init__(self):
        self.records: Dict[str, Dict] = {}
        self.vcenter_status: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        self.load()
    
    def load(self):
        try:
            if os.path.exists(CMDB_FILE):
                with open(CMDB_FILE, 'r') as f:
                    data = json.load(f)
                    self.records = data.get('records', {})
                    self.vcenter_status = data.get('vcenter_status', {})
                print(f"[CMDB] Loaded {len(self.records)} records")
        except Exception as e:
            print(f"[CMDB] Error loading: {e}")
            self.records = {}
            self.vcenter_status = {}
    
    def save(self):
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(CMDB_FILE, 'w') as f:
                json.dump({
                    'records': self.records,
                    'vcenter_status': self.vcenter_status,
                    'last_updated': datetime.now().isoformat()
                }, f, indent=2, default=str)
        except Exception as e:
            print(f"[CMDB] Error saving: {e}")
    
    def update_vcenter_status(self, vcenter_name: str, connected: bool, error_message: str = None):
        now = datetime.now().isoformat()
        if vcenter_name not in self.vcenter_status:
            self.vcenter_status[vcenter_name] = {'first_seen': now}
        
        self.vcenter_status[vcenter_name]['connected'] = connected
        if connected:
            self.vcenter_status[vcenter_name]['last_connected'] = now
            self.vcenter_status[vcenter_name]['error_message'] = None
        else:
            self.vcenter_status[vcenter_name]['last_disconnected'] = now
            self.vcenter_status[vcenter_name]['error_message'] = error_message
    
    def get_disconnected_vcenters(self) -> List[str]:
        return [vc for vc, status in self.vcenter_status.items() if not status.get('connected', False)]
    
    def ping_host(self, hostname: str, timeout: int = 2) -> bool:
        try:
            result = subprocess.run(['ping', '-c', '1', '-W', str(timeout), hostname],
                                    capture_output=True, timeout=timeout + 1)
            return result.returncode == 0
        except:
            return False
    
    def verify_unreachable_vms(self, max_vms: int = 200) -> Dict:
        unchecked = [r for r in self.records.values() 
                     if r.get('status') == 'unreachable' and not r.get('pingStatus')]
        to_check = unchecked[:max_vms]
        
        if not to_check:
            return {'checked': 0, 'reachable': 0, 'still_unreachable': 0}
        
        stats = {'checked': len(to_check), 'reachable': 0, 'still_unreachable': 0}
        now = datetime.now().isoformat()
        
        def check_vm(vm):
            name = vm.get('vmName', '')
            ip = vm.get('ipAddress', '')
            return name, self.ping_host(name) or (ip and self.ping_host(ip))
        
        with ThreadPoolExecutor(max_workers=50) as executor:
            futures = {executor.submit(check_vm, vm): vm for vm in to_check}
            for future in as_completed(futures):
                vm = futures[future]
                vm_key = vm.get('vmKey', '')
                try:
                    name, reachable = future.result()
                    if vm_key in self.records:
                        self.records[vm_key]['pingStatus'] = 'reachable' if reachable else 'unreachable'
                        self.records[vm_key]['lastPingCheck'] = now
                        if reachable:
                            stats['reachable'] += 1
                        else:
                            stats['still_unreachable'] += 1
                except:
                    pass
        
        self.save()
        return stats
    
    def update_from_refresh(self, current_vms: List[Dict], connected_vcenters: List[str], 
                           disconnected_vcenters: List[str] = None):
        """Update CMDB - properly handles vCenter reconnection"""
        now = datetime.now().isoformat()
        disconnected_vcenters = disconnected_vcenters or []
        
        print(f"[CMDB] Starting update: {len(current_vms)} VMs, {len(connected_vcenters)} connected vCenters")
        
        # Update vCenter status
        for vc in connected_vcenters:
            self.update_vcenter_status(vc, True)
        for vc in disconnected_vcenters:
            self.update_vcenter_status(vc, False)
        
        # Build lookup for current VMs
        current_vm_keys = {}
        for vm in current_vms:
            vm_key = self._get_vm_key(vm)
            current_vm_keys[vm_key] = vm
        
        # Build index of existing records by (vcenterName, vmId) to detect old-style key duplicates
        existing_by_vmid: Dict[tuple, str] = {}
        for k, v in self.records.items():
            vid = v.get('vmId', '')
            vc = v.get('vcenterName', '')
            if vid and vc:
                existing_by_vmid[(vc, vid)] = k

        # Remove old-style vcenter:vmId keys that now have a matching uuid: key
        # This prevents duplicates after data is refreshed from live vCenter
        new_uuid_keys = {k for k in current_vm_keys if k.startswith('uuid:')}
        for uuid_key in new_uuid_keys:
            vm = current_vm_keys[uuid_key]
            vid = vm.get('vmId', '')
            vc = vm.get('vcenterName', '')
            old_key = existing_by_vmid.get((vc, vid))
            if old_key and old_key != uuid_key and not old_key.startswith('uuid:'):
                old_rec = self.records.pop(old_key, {})
                # Preserve historical metadata into the uuid record if it exists
                if uuid_key in self.records:
                    for field in ('firstSeen', 'first_seen', 'cmdb_status', 'changeHistory', 'change_history'):
                        if old_rec.get(field) and not self.records[uuid_key].get(field):
                            self.records[uuid_key][field] = old_rec[field]

        stats = {'new': 0, 'updated': 0, 'unchanged': 0, 'reactivated': 0, 
                 'decommissioned': 0, 'unreachable': 0}
        
        # Process current VMs - add/update
        for vm_key, vm in current_vm_keys.items():
            if vm_key in self.records:
                existing = self.records[vm_key]
                old_status = existing.get('status')
                
                # REACTIVATE: VM is back from unreachable/decommissioned
                if old_status in ['unreachable', 'decommissioned']:
                    print(f"[CMDB] REACTIVATING: {vm.get('vmName')} (was {old_status})")
                    existing['status'] = 'active'
                    existing['reactivatedDate'] = now
                    existing.pop('pingStatus', None)
                    existing.pop('lastPingCheck', None)
                    existing.pop('unreachableSince', None)
                    existing.pop('unreachableReason', None)
                    existing.pop('decommissionedDate', None)
                    stats['reactivated'] += 1
                
                # Update fields
                existing['lastSeen'] = now
                for key, value in vm.items():
                    if key not in ['status', 'firstSeen', 'changeHistory', 'vmKey']:
                        existing[key] = value
                existing['status'] = 'active'
                
                if old_status == 'active':
                    stats['updated'] += 1
            else:
                # New VM
                self.records[vm_key] = {
                    **vm,
                    'vmKey': vm_key,
                    'status': 'active',
                    'firstSeen': now,
                    'lastSeen': now,
                    'changeHistory': []
                }
                stats['new'] += 1
        
        # Process existing records not in current data
        for vm_key, record in list(self.records.items()):
            if vm_key in current_vm_keys:
                continue  # Already processed
            
            current_status = record.get('status', 'active')
            vm_vcenter = record.get('vcenterName', '')
            
            # Skip already decommissioned
            if current_status == 'decommissioned':
                continue
            
            # If vCenter is connected but VM is gone -> decommissioned
            if vm_vcenter in connected_vcenters:
                if current_status in ['active', 'unreachable']:
                    print(f"[CMDB] DECOMMISSIONING: {record.get('vmName')} (vCenter {vm_vcenter} connected but VM gone)")
                    record['status'] = 'decommissioned'
                    record['decommissionedDate'] = now
                    stats['decommissioned'] += 1
            
            # If vCenter is disconnected -> unreachable (not decommissioned)
            elif vm_vcenter in disconnected_vcenters:
                if current_status == 'active':
                    record['status'] = 'unreachable'
                    record['unreachableSince'] = now
                    record['unreachableReason'] = f"vCenter {vm_vcenter} disconnected"
                    stats['unreachable'] += 1
        
        self.save()
        print(f"[CMDB] Update complete: {stats}")
        return stats
    
    def _get_vm_key(self, vm: Dict) -> str:
        uuid = vm.get('uuid') or vm.get('instanceUuid')
        if uuid:
            return f"uuid:{uuid}"
        return f"name:{vm.get('vmName', 'unknown')}:{vm.get('vcenterName', 'unknown')}"
    
    def get_all(self, include_decommissioned: bool = True) -> List[Dict]:
        records = list(self.records.values())
        if not include_decommissioned:
            records = [r for r in records if r.get('status') != 'decommissioned']
        for i, r in enumerate(records):
            r['ID'] = i + 1
        return sorted(records, key=lambda x: x.get('vmName', ''))
    
    def get_active(self) -> List[Dict]:
        return [r for r in self.records.values() if r.get('status') == 'active']
    
    def get_unreachable(self) -> List[Dict]:
        return [r for r in self.records.values() if r.get('status') == 'unreachable']
    
    def get_vm(self, identifier: str) -> Optional[Dict]:
        if identifier in self.records:
            return self.records[identifier]
        for record in self.records.values():
            if record.get('vmName') == identifier:
                return record
            if record.get('uuid') == identifier or record.get('instanceUuid') == identifier:
                return record
        return None
    
    def get_stats(self) -> Dict:
        all_records = list(self.records.values())
        return {
            'total': len(all_records),
            'active': len([r for r in all_records if r.get('status') == 'active']),
            'unreachable': len([r for r in all_records if r.get('status') == 'unreachable']),
            'decommissioned': len([r for r in all_records if r.get('status') == 'decommissioned']),
            'with_puppet': len([r for r in all_records if r.get('puppetData', {}).get('puppet_found')]),
            'puppet_failed': len([r for r in all_records if r.get('puppetData', {}).get('puppet_last_status') == 'failed']),
            'vcenter_status': self.vcenter_status,
            'disconnected_vcenters': self.get_disconnected_vcenters()
        }


historical_cmdb = HistoricalCMDB()
