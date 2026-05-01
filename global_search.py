#!/usr/bin/env python3
"""
Global Search Module - Search across all resources
"""

from typing import Dict, List, Any
from datetime import datetime

class GlobalSearch:
    def __init__(self, data_cache: Dict, cmdb):
        self.data_cache = data_cache
        self.cmdb = cmdb
    
    def search(self, query: str, limit: int = 50) -> Dict[str, List]:
        """Search across all resources"""
        if not query or len(query) < 2:
            return {'results': [], 'total': 0}
        
        query_lower = query.lower()
        results = {
            'vms': [],
            'hosts': [],
            'datastores': [],
            'networks': [],
            'total': 0
        }
        
        # Search VMs (from CMDB for complete data)
        try:
            all_vms = self.cmdb.get_all(include_decommissioned=False)
            for vm in all_vms:
                if self._matches(vm, query_lower, ['vmName', 'ipAddress', 'hostName', 'cluster', 'guestOS', 'uuid']):
                    results['vms'].append({
                        'type': 'vm',
                        'name': vm.get('vmName'),
                        'status': vm.get('status', 'active'),
                        'vcenter': vm.get('vcenterName', '').split('.')[0],
                        'ip': vm.get('ipAddress'),
                        'host': vm.get('hostName', '').split('.')[0],
                        'match_field': self._get_match_field(vm, query_lower, ['vmName', 'ipAddress', 'hostName', 'cluster'])
                    })
                    if len(results['vms']) >= limit:
                        break
        except Exception as e:
            print(f"[SEARCH] VM search error: {e}")
        
        # Search Hosts
        try:
            hosts = self.data_cache.get('hosts', [])
            for host in hosts:
                if self._matches(host, query_lower, ['hostName', 'clusterName', 'vcenterName', 'cpuModel']):
                    results['hosts'].append({
                        'type': 'host',
                        'name': host.get('hostName', '').split('.')[0],
                        'fullName': host.get('hostName'),
                        'vcenter': host.get('vcenterName', '').split('.')[0],
                        'cluster': host.get('clusterName'),
                        'match_field': self._get_match_field(host, query_lower, ['hostName', 'clusterName'])
                    })
                    if len(results['hosts']) >= limit:
                        break
        except Exception as e:
            print(f"[SEARCH] Host search error: {e}")
        
        # Search Datastores
        try:
            datastores = self.data_cache.get('datastores', [])
            for ds in datastores:
                if self._matches(ds, query_lower, ['datastoreName', 'vcenterName', 'type']):
                    results['datastores'].append({
                        'type': 'datastore',
                        'name': ds.get('datastoreName'),
                        'vcenter': ds.get('vcenterName', '').split('.')[0],
                        'dsType': ds.get('type'),
                        'usagePct': float(ds.get('usagePct', 0) or 0),
                        'match_field': self._get_match_field(ds, query_lower, ['datastoreName'])
                    })
                    if len(results['datastores']) >= limit:
                        break
        except Exception as e:
            print(f"[SEARCH] Datastore search error: {e}")
        
        # Search Networks
        try:
            networks = self.data_cache.get('networks', [])
            for net in networks:
                if self._matches(net, query_lower, ['networkName', 'vcenterName', 'type']):
                    results['networks'].append({
                        'type': 'network',
                        'name': net.get('networkName'),
                        'vcenter': net.get('vcenterName', '').split('.')[0],
                        'netType': net.get('type'),
                        'match_field': self._get_match_field(net, query_lower, ['networkName'])
                    })
                    if len(results['networks']) >= limit:
                        break
        except Exception as e:
            print(f"[SEARCH] Network search error: {e}")
        
        results['total'] = len(results['vms']) + len(results['hosts']) + len(results['datastores']) + len(results['networks'])
        
        return results
    
    def _matches(self, item: Dict, query: str, fields: List[str]) -> bool:
        """Check if any field contains the query"""
        for field in fields:
            value = str(item.get(field, '')).lower()
            if query in value:
                return True
        return False
    
    def _get_match_field(self, item: Dict, query: str, fields: List[str]) -> str:
        """Get the field that matched"""
        for field in fields:
            value = str(item.get(field, '')).lower()
            if query in value:
                return field
        return ''

# Will be initialized with data
global_search = None
