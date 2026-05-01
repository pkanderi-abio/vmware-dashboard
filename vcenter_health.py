#!/usr/bin/env python3
"""
vCenter Health Check Module - v3
Syncs with actual pyvmomi connections
"""

import os
import json
import subprocess
import ssl
import socket
import urllib.request
import urllib.error
from datetime import datetime
from typing import Dict, List
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

CACHE_DIR = os.path.expanduser("~/.vmware-dashboard-cache")
VCENTER_HEALTH_FILE = os.path.join(CACHE_DIR, "vcenter_health.json")

class VCenterHealthChecker:
    def __init__(self):
        self.health_status: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        self.load()
    
    def load(self):
        """Load cached health status"""
        try:
            if os.path.exists(VCENTER_HEALTH_FILE):
                with open(VCENTER_HEALTH_FILE, 'r') as f:
                    self.health_status = json.load(f)
                print(f"[VCHEALTH] Loaded health status for {len(self.health_status)} vCenters")
        except Exception as e:
            print(f"[VCHEALTH] Error loading: {e}")
            self.health_status = {}
    
    def save(self):
        """Save health status to disk"""
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(VCENTER_HEALTH_FILE, 'w') as f:
                json.dump(self.health_status, f, indent=2, default=str)
        except Exception as e:
            print(f"[VCHEALTH] Error saving: {e}")
    
    def ping_check(self, hostname: str, timeout: int = 3) -> Dict:
        """Check if vCenter responds to ping"""
        try:
            result = subprocess.run(
                ['ping', '-c', '2', '-W', str(timeout), hostname],
                capture_output=True,
                timeout=timeout + 2
            )
            success = result.returncode == 0
            
            latency = None
            if success and result.stdout:
                output = result.stdout.decode()
                import re
                match = re.search(r'time=(\d+\.?\d*)', output)
                if match:
                    latency = float(match.group(1))
            
            return {
                'status': 'ok' if success else 'failed',
                'reachable': success,
                'latency_ms': latency,
                'checked_at': datetime.now().isoformat()
            }
        except subprocess.TimeoutExpired:
            return {'status': 'timeout', 'reachable': False, 'checked_at': datetime.now().isoformat()}
        except Exception as e:
            return {'status': 'error', 'reachable': False, 'error': str(e), 'checked_at': datetime.now().isoformat()}
    
    def https_check(self, hostname: str, timeout: int = 10) -> Dict:
        """Check if vCenter HTTPS/Web UI is responding"""
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            url = f"https://{hostname}/ui/"
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'VMware-Dashboard/1.0')
            
            start_time = datetime.now()
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
                response_time = (datetime.now() - start_time).total_seconds() * 1000
                return {
                    'status': 'ok',
                    'responding': True,
                    'http_code': response.status,
                    'response_time_ms': round(response_time, 1),
                    'checked_at': datetime.now().isoformat()
                }
        except urllib.error.HTTPError as e:
            return {
                'status': 'ok',
                'responding': True,
                'http_code': e.code,
                'checked_at': datetime.now().isoformat()
            }
        except urllib.error.URLError as e:
            return {
                'status': 'failed',
                'responding': False,
                'error': str(e.reason) if hasattr(e, 'reason') else str(e),
                'checked_at': datetime.now().isoformat()
            }
        except socket.timeout:
            return {'status': 'timeout', 'responding': False, 'checked_at': datetime.now().isoformat()}
        except Exception as e:
            return {'status': 'error', 'responding': False, 'error': str(e), 'checked_at': datetime.now().isoformat()}
    
    def sdk_check(self, hostname: str, timeout: int = 10) -> Dict:
        """Check vCenter SDK endpoint"""
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            url = f"https://{hostname}/sdk/vimServiceVersions.xml"
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'VMware-Dashboard/1.0')
            
            start_time = datetime.now()
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
                response_time = (datetime.now() - start_time).total_seconds() * 1000
                return {
                    'status': 'ok',
                    'sdk_available': True,
                    'response_time_ms': round(response_time, 1),
                    'checked_at': datetime.now().isoformat()
                }
        except urllib.error.HTTPError as e:
            if e.code in [401, 403]:
                return {'status': 'ok', 'sdk_available': True, 'requires_auth': True, 'checked_at': datetime.now().isoformat()}
            return {'status': 'error', 'sdk_available': False, 'http_code': e.code, 'checked_at': datetime.now().isoformat()}
        except Exception as e:
            return {'status': 'error', 'sdk_available': False, 'error': str(e), 'checked_at': datetime.now().isoformat()}
    
    def check_vcenter(self, hostname: str, is_connected: bool = None) -> Dict:
        """Check a single vCenter - optionally use known connection status"""
        now = datetime.now().isoformat()
        
        result = {
            'hostname': hostname,
            'checked_at': now,
            'ping': self.ping_check(hostname),
            'https': self.https_check(hostname),
            'sdk': self.sdk_check(hostname)
        }
        
        ping_ok = result['ping'].get('reachable', False)
        https_ok = result['https'].get('responding', False)
        sdk_ok = result['sdk'].get('sdk_available', False)
        
        # Use provided connection status if available
        if is_connected is not None:
            result['session'] = {
                'status': 'connected' if is_connected else 'unknown',
                'connected': is_connected,
                'checked_at': now
            }
        else:
            existing = self.health_status.get(hostname, {})
            result['session'] = existing.get('session', {'status': 'unknown', 'checked_at': now})
        
        session_connected = result['session'].get('connected', False)
        
        # Determine overall status
        if session_connected and ping_ok and https_ok:
            result['overall_status'] = 'healthy'
            result['overall_message'] = 'All checks passed - Connected'
        elif ping_ok and https_ok and sdk_ok:
            if session_connected:
                result['overall_status'] = 'healthy'
                result['overall_message'] = 'All checks passed - Connected'
            else:
                result['overall_status'] = 'service_ok'
                result['overall_message'] = 'Service responding - Checking connection...'
        elif ping_ok and https_ok:
            result['overall_status'] = 'degraded'
            result['overall_message'] = 'Ping and HTTPS OK, SDK issue'
        elif ping_ok:
            result['overall_status'] = 'service_down'
            result['overall_message'] = 'Ping OK, Web service not responding'
        else:
            result['overall_status'] = 'unreachable'
            result['overall_message'] = 'Not responding to ping'
        
        return result
    
    def sync_with_connections(self, connected_vcenters: List[str], all_known_vcenters: List[str] = None):
        """
        Sync health status with actual pyvmomi connections
        This is called after each refresh to update session status
        """
        now = datetime.now().isoformat()
        
        # Update connected vCenters
        for hostname in connected_vcenters:
            if hostname not in self.health_status:
                self.health_status[hostname] = {
                    'hostname': hostname,
                    'checked_at': now,
                    'ping': {'status': 'ok', 'reachable': True},
                    'https': {'status': 'ok', 'responding': True},
                    'sdk': {'status': 'ok', 'sdk_available': True}
                }
            
            self.health_status[hostname]['session'] = {
                'status': 'connected',
                'connected': True,
                'checked_at': now
            }
            self.health_status[hostname]['overall_status'] = 'healthy'
            self.health_status[hostname]['overall_message'] = 'Connected and operational'
            self.health_status[hostname]['checked_at'] = now
        
        # Update disconnected vCenters
        if all_known_vcenters:
            for hostname in all_known_vcenters:
                if hostname not in connected_vcenters:
                    if hostname not in self.health_status:
                        self.health_status[hostname] = {
                            'hostname': hostname,
                            'checked_at': now
                        }
                    
                    # Only mark as disconnected if it was previously connected
                    # or if we haven't checked it yet
                    current_status = self.health_status[hostname].get('overall_status')
                    if current_status == 'healthy':
                        self.health_status[hostname]['session'] = {
                            'status': 'failed',
                            'connected': False,
                            'error_message': 'Connection lost',
                            'checked_at': now
                        }
                        self.health_status[hostname]['overall_status'] = 'auth_failed'
                        self.health_status[hostname]['overall_message'] = 'Connection lost'
                        self.health_status[hostname]['checked_at'] = now
        
        self.save()
        known_count = len(all_known_vcenters or [])
        connected_count = len(connected_vcenters or [])
        disconnected_count = max(known_count - connected_count, 0)
        print(f"[VCHEALTH] Synced: {connected_count} connected, {disconnected_count} disconnected")
    
    def check_all_vcenters(self, hostnames: List[str], connected_vcenters: List[str] = None, max_workers: int = 10) -> Dict[str, Dict]:
        """Check all vCenters in parallel"""
        results = {}
        
        print(f"[VCHEALTH] Checking {len(hostnames)} vCenters...")
        
        # Create a set of connected vCenters for quick lookup
        connected_set = set(connected_vcenters or [])
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self.check_vcenter, h, h in connected_set): h for h in hostnames}
            for future in as_completed(futures):
                hostname = futures[future]
                try:
                    result = future.result()
                    
                    # Override session status if we know it's connected
                    if hostname in connected_set:
                        result['session'] = {'status': 'connected', 'connected': True, 'checked_at': datetime.now().isoformat()}
                        result['overall_status'] = 'healthy'
                        result['overall_message'] = 'Connected and operational'
                    
                    results[hostname] = result
                    self.health_status[hostname] = result
                except Exception as e:
                    results[hostname] = {
                        'hostname': hostname,
                        'overall_status': 'error',
                        'overall_message': str(e),
                        'checked_at': datetime.now().isoformat()
                    }
                    self.health_status[hostname] = results[hostname]
        
        self.save()
        print(f"[VCHEALTH] Health check complete for {len(results)} vCenters")
        return results
    
    def update_session_status(self, hostname: str, connected: bool, error_message: str = None):
        """Update session status for a vCenter"""
        now = datetime.now().isoformat()
        
        if hostname not in self.health_status:
            self.health_status[hostname] = {
                'hostname': hostname,
                'overall_status': 'unknown',
                'checked_at': now,
                'ping': {'status': 'unknown'},
                'https': {'status': 'unknown'},
                'sdk': {'status': 'unknown'}
            }
        
        self.health_status[hostname]['session'] = {
            'status': 'connected' if connected else 'failed',
            'connected': connected,
            'error_message': error_message,
            'checked_at': now
        }
        
        if connected:
            self.health_status[hostname]['overall_status'] = 'healthy'
            self.health_status[hostname]['overall_message'] = 'Connected and operational'
        else:
            ping_ok = self.health_status[hostname].get('ping', {}).get('reachable', False)
            https_ok = self.health_status[hostname].get('https', {}).get('responding', False)
            
            if ping_ok and https_ok:
                error_lower = (error_message or '').lower()
                if 'ldap' in error_lower or 'active directory' in error_lower:
                    self.health_status[hostname]['overall_status'] = 'auth_failed_ldap'
                    self.health_status[hostname]['overall_message'] = f'LDAP/AD issue: {error_message}'
                elif 'password' in error_lower or 'credential' in error_lower:
                    self.health_status[hostname]['overall_status'] = 'auth_failed_creds'
                    self.health_status[hostname]['overall_message'] = f'Credential issue: {error_message}'
                else:
                    self.health_status[hostname]['overall_status'] = 'auth_failed'
                    self.health_status[hostname]['overall_message'] = f'Auth failed: {error_message}'
            else:
                self.health_status[hostname]['overall_status'] = 'unreachable'
                self.health_status[hostname]['overall_message'] = 'vCenter not reachable'
        
        self.health_status[hostname]['checked_at'] = now
        self.save()
    
    def get_status(self, hostname: str) -> Dict:
        return self.health_status.get(hostname, {
            'hostname': hostname,
            'overall_status': 'unknown',
            'overall_message': 'Not checked yet'
        })
    
    def get_all_status(self) -> Dict[str, Dict]:
        return self.health_status
    
    def get_summary(self) -> Dict:
        summary = {
            'total': len(self.health_status),
            'healthy': 0,
            'service_ok': 0,
            'degraded': 0,
            'auth_failed': 0,
            'auth_failed_ldap': 0,
            'unreachable': 0,
            'unknown': 0,
            'last_check': None,
            'vcenters': []
        }
        
        for hostname, status in self.health_status.items():
            overall = status.get('overall_status', 'unknown')
            
            if overall == 'healthy':
                summary['healthy'] += 1
            elif overall == 'service_ok':
                summary['service_ok'] += 1
            elif overall == 'degraded':
                summary['degraded'] += 1
            elif overall.startswith('auth_failed'):
                summary['auth_failed'] += 1
                if 'ldap' in overall:
                    summary['auth_failed_ldap'] += 1
            elif overall in ['unreachable', 'service_down']:
                summary['unreachable'] += 1
            else:
                summary['unknown'] += 1
            
            checked_at = status.get('checked_at')
            if checked_at:
                if not summary['last_check'] or checked_at > summary['last_check']:
                    summary['last_check'] = checked_at
            
            summary['vcenters'].append({
                'hostname': hostname,
                'short_name': hostname.split('.')[0],
                'status': overall,
                'message': status.get('overall_message', ''),
                'ping': status.get('ping', {}).get('status', 'unknown'),
                'https': status.get('https', {}).get('status', 'unknown'),
                'sdk': status.get('sdk', {}).get('status', 'unknown'),
                'session': status.get('session', {}).get('status', 'unknown'),
                'latency_ms': status.get('ping', {}).get('latency_ms'),
                'checked_at': status.get('checked_at')
            })
        
        return summary


# Singleton instance
vcenter_health = VCenterHealthChecker()
