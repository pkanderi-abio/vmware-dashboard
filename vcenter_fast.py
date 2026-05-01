#!/usr/bin/env python3
"""
Fast vCenter Data Collection using PropertyCollector
Optimized for large-scale environments
"""

from pyVmomi import vim, vmodl
from pyVim.connect import SmartConnect, Disconnect
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

class FastVCenterCollector:
    """Optimized vCenter data collector using PropertyCollector for batch operations"""
    
    def __init__(self, hostname, username, password):
        self.hostname = hostname
        self.username = username
        self.password = password
        self.si = None
        self.content = None
        self.custom_attr_map = {}
    
    def connect(self):
        """Connect to vCenter"""
        try:
            ctx = ssl._create_unverified_context()
            self.si = SmartConnect(
                host=self.hostname,
                user=self.username,
                pwd=self.password,
                sslContext=ctx,
                connectionPoolTimeout=30
            )
            self.content = self.si.RetrieveContent()
            self._load_custom_attributes()
            print(f"[FAST] ✓ Connected to {self.hostname}")
            return True
        except Exception as e:
            print(f"[FAST] ✗ Failed to connect to {self.hostname}: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from vCenter"""
        if self.si:
            try:
                Disconnect(self.si)
            except:
                pass
    
    def _load_custom_attributes(self):
        """Load custom attribute definitions"""
        self.custom_attr_map = {}
        try:
            if self.content.customFieldsManager:
                for field in self.content.customFieldsManager.field:
                    self.custom_attr_map[field.key] = field.name
        except:
            pass
    
    def _create_filter_spec(self, obj_type, properties, container=None):
        """Create a PropertyCollector filter spec for efficient batch retrieval"""
        if container is None:
            container = self.content.rootFolder
        
        view_ref = self.content.viewManager.CreateContainerView(
            container=container,
            type=[obj_type],
            recursive=True
        )
        
        traversal_spec = vmodl.query.PropertyCollector.TraversalSpec(
            name='traverseEntities',
            path='view',
            skip=False,
            type=vim.view.ContainerView
        )
        
        obj_spec = vmodl.query.PropertyCollector.ObjectSpec(
            obj=view_ref,
            skip=True,
            selectSet=[traversal_spec]
        )
        
        prop_set = vmodl.query.PropertyCollector.PropertySpec(
            type=obj_type,
            pathSet=properties,
            all=False
        )
        
        filter_spec = vmodl.query.PropertyCollector.FilterSpec(
            objectSet=[obj_spec],
            propSet=[prop_set]
        )
        
        return filter_spec, view_ref
    
    def _retrieve_properties(self, obj_type, properties):
        """Retrieve properties for all objects of a type in a single call"""
        filter_spec, view_ref = self._create_filter_spec(obj_type, properties)
        
        try:
            props = self.content.propertyCollector.RetrieveContents([filter_spec])
            return props
        finally:
            view_ref.Destroy()
    
    def get_all_vms_fast(self):
        """Get all VMs using PropertyCollector for fast batch retrieval"""
        vms = []
        start_time = time.time()
        
        # Define properties to retrieve in batch
        vm_properties = [
            'name',
            'config.hardware.numCPU',
            'config.hardware.memoryMB',
            'config.guestFullName',
            'config.version',
            'config.annotation',
            'config.uuid',
            'config.instanceUuid',
            'config.createDate',
            'runtime.powerState',
            'runtime.host',
            'guest.ipAddress',
            'guest.guestState',
            'guest.toolsStatus',
            'guest.toolsVersion',
            'guest.net',
            'summary.quickStats.overallCpuUsage',
            'summary.quickStats.guestMemoryUsage',
            'summary.quickStats.hostMemoryUsage',
            'summary.storage.committed',
            'summary.storage.uncommitted',
            'parent',
            'resourcePool',
            'datastore',
            'snapshot',
            'customValue',
        ]
        
        try:
            print(f"[FAST] Collecting VMs from {self.hostname}...")
            props = self._retrieve_properties(vim.VirtualMachine, vm_properties)
            
            # Build host info cache for location lookup
            host_info_cache = self._build_host_info_cache()
            
            for obj in props:
                try:
                    vm_data = {'vmId': str(obj.obj._moId), 'vcenterName': self.hostname}
                    prop_dict = {prop.name: prop.val for prop in obj.propSet} if obj.propSet else {}
                    
                    # Basic info
                    vm_data['vmName'] = prop_dict.get('name', '')
                    
                    # Power state
                    power_state = str(prop_dict.get('runtime.powerState', 'Unknown'))
                    power_state = power_state.replace('vim.VirtualMachine.PowerState.', '')
                    vm_data['powerState'] = {'Value': power_state}
                    is_powered_on = 'on' in power_state.lower()
                    
                    # CPU
                    cpu_count = prop_dict.get('config.hardware.numCPU', 0) or 0
                    vm_data['cpuCount'] = str(cpu_count)
                    
                    # Memory
                    memory_mb = prop_dict.get('config.hardware.memoryMB', 0) or 0
                    vm_data['memoryMB'] = str(int(memory_mb))
                    vm_data['memoryGB'] = str(round(memory_mb / 1024, 2))
                    
                    # CPU Usage
                    cpu_usage_mhz = 0
                    cpu_usage_pct = 0.0
                    if is_powered_on:
                        cpu_usage_mhz = prop_dict.get('summary.quickStats.overallCpuUsage', 0) or 0
                        if cpu_usage_mhz > 0 and cpu_count > 0:
                            # Estimate based on 2.5GHz CPU
                            total_mhz = cpu_count * 2500
                            cpu_usage_pct = min(round((cpu_usage_mhz / total_mhz) * 100, 1), 100.0)
                    vm_data['cpuUsageMhz'] = str(int(cpu_usage_mhz))
                    vm_data['cpuUsagePct'] = str(cpu_usage_pct)
                    
                    # Memory Usage
                    memory_usage_mb = 0
                    memory_usage_pct = 0.0
                    if is_powered_on:
                        memory_usage_mb = prop_dict.get('summary.quickStats.guestMemoryUsage', 0) or 0
                        if memory_usage_mb == 0:
                            memory_usage_mb = prop_dict.get('summary.quickStats.hostMemoryUsage', 0) or 0
                        if memory_usage_mb > 0 and memory_mb > 0:
                            memory_usage_pct = min(round((memory_usage_mb / memory_mb) * 100, 1), 100.0)
                    vm_data['memoryUsageMB'] = str(int(memory_usage_mb))
                    vm_data['memoryUsagePct'] = str(memory_usage_pct)
                    
                    # Guest info
                    vm_data['guestOS'] = prop_dict.get('config.guestFullName', '') or ''
                    vm_data['guestState'] = prop_dict.get('guest.guestState', '') or ''
                    vm_data['ipAddress'] = prop_dict.get('guest.ipAddress', '') or ''
                    
                    # Tools
                    tools_status = prop_dict.get('guest.toolsStatus', 'Unknown')
                    vm_data['toolsStatus'] = str(tools_status) if tools_status else 'Unknown'
                    vm_data['toolsVersion'] = prop_dict.get('guest.toolsVersion', '') or ''
                    
                    # Hardware version
                    vm_data['hardwareVersion'] = prop_dict.get('config.version', '') or ''
                    
                    # Annotation
                    vm_data['annotation'] = prop_dict.get('config.annotation', '') or ''
                    
                    # UUIDs
                    vm_data['uuid'] = prop_dict.get('config.uuid', '') or ''
                    vm_data['instanceUuid'] = prop_dict.get('config.instanceUuid', '') or ''
                    
                    # Create date
                    create_date = prop_dict.get('config.createDate')
                    vm_data['createDate'] = str(create_date) if create_date else ''
                    
                    # Location (from host cache)
                    host_ref = prop_dict.get('runtime.host')
                    if host_ref:
                        host_key = str(host_ref._moId)
                        host_info = host_info_cache.get(host_key, {})
                        vm_data['hostName'] = host_info.get('name', '')
                        vm_data['cluster'] = host_info.get('cluster', '')
                        vm_data['datacenter'] = host_info.get('datacenter', '')
                    else:
                        vm_data['hostName'] = ''
                        vm_data['cluster'] = ''
                        vm_data['datacenter'] = ''
                    
                    # Folder
                    parent = prop_dict.get('parent')
                    vm_data['folder'] = parent.name if parent else ''
                    
                    # Resource Pool
                    rp = prop_dict.get('resourcePool')
                    vm_data['resourcePool'] = rp.name if rp else ''
                    
                    # Datastores
                    datastores = prop_dict.get('datastore', [])
                    vm_data['datastores'] = [ds.name for ds in datastores] if datastores else []
                    
                    # Storage
                    committed = prop_dict.get('summary.storage.committed', 0) or 0
                    vm_data['totalDiskGB'] = str(round(committed / (1024**3), 2))
                    vm_data['numVirtualDisks'] = '0'  # Would need separate call
                    
                    # Network
                    vm_data['ipAddresses'] = []
                    vm_data['macAddresses'] = []
                    guest_net = prop_dict.get('guest.net', [])
                    if guest_net:
                        for nic in guest_net:
                            if hasattr(nic, 'ipAddress') and nic.ipAddress:
                                vm_data['ipAddresses'].extend(nic.ipAddress)
                            if hasattr(nic, 'macAddress') and nic.macAddress:
                                vm_data['macAddresses'].append(nic.macAddress)
                    vm_data['numEthernetCards'] = str(len(vm_data['macAddresses']))
                    
                    # Snapshots
                    snapshot = prop_dict.get('snapshot')
                    if snapshot and hasattr(snapshot, 'rootSnapshotList') and snapshot.rootSnapshotList:
                        vm_data['hasSnapshot'] = 'Yes'
                        
                        def count_snaps(snap_list):
                            count = len(snap_list)
                            for s in snap_list:
                                if s.childSnapshotList:
                                    count += count_snaps(s.childSnapshotList)
                            return count
                        
                        vm_data['snapshotCount'] = str(count_snaps(snapshot.rootSnapshotList))
                    else:
                        vm_data['hasSnapshot'] = 'No'
                        vm_data['snapshotCount'] = '0'
                    
                    # Custom Attributes
                    custom_attrs = {}
                    custom_values = prop_dict.get('customValue', [])
                    if custom_values:
                        for cv in custom_values:
                            attr_name = self.custom_attr_map.get(cv.key, f'CustomField_{cv.key}')
                            custom_attrs[attr_name] = cv.value or ''
                    vm_data['customAttributes'] = custom_attrs
                    
                    vms.append(vm_data)
                    
                except Exception as e:
                    print(f"[FAST] Error processing VM: {e}")
                    continue
            
            elapsed = round(time.time() - start_time, 1)
            print(f"[FAST] ✓ Collected {len(vms)} VMs from {self.hostname} in {elapsed}s")
            
        except Exception as e:
            print(f"[FAST] ✗ Error collecting VMs from {self.hostname}: {e}")
            import traceback
            traceback.print_exc()
        
        return vms
    
    def _build_host_info_cache(self):
        """Build a cache of host information for fast lookups"""
        cache = {}
        
        try:
            host_properties = ['name', 'parent']
            props = self._retrieve_properties(vim.HostSystem, host_properties)
            
            for obj in props:
                prop_dict = {prop.name: prop.val for prop in obj.propSet} if obj.propSet else {}
                host_key = str(obj.obj._moId)
                
                host_info = {
                    'name': prop_dict.get('name', ''),
                    'cluster': '',
                    'datacenter': ''
                }
                
                # Walk up the parent chain
                parent = prop_dict.get('parent')
                while parent:
                    if isinstance(parent, vim.ClusterComputeResource):
                        host_info['cluster'] = parent.name
                    elif isinstance(parent, vim.Datacenter):
                        host_info['datacenter'] = parent.name
                        break
                    parent = getattr(parent, 'parent', None)
                
                cache[host_key] = host_info
                
        except Exception as e:
            print(f"[FAST] Error building host cache: {e}")
        
        return cache
    
    def get_all_hosts_fast(self):
        """Get all hosts using PropertyCollector"""
        hosts = []
        start_time = time.time()
        
        host_properties = [
            'name',
            'hardware.cpuInfo.numCpuCores',
            'hardware.cpuInfo.numCpuPackages',
            'hardware.cpuInfo.numCpuThreads',
            'hardware.cpuInfo.hz',
            'hardware.cpuPkg',
            'hardware.memorySize',
            'hardware.systemInfo.vendor',
            'hardware.systemInfo.model',
            'hardware.systemInfo.uuid',
            'hardware.biosInfo.biosVersion',
            'summary.config.product.version',
            'summary.config.product.build',
            'summary.config.product.fullName',
            'summary.quickStats.overallCpuUsage',
            'summary.quickStats.overallMemoryUsage',
            'runtime.connectionState',
            'runtime.powerState',
            'runtime.inMaintenanceMode',
            'runtime.bootTime',
            'parent',
            'vm',
            'datastore',
        ]
        
        try:
            print(f"[FAST] Collecting Hosts from {self.hostname}...")
            props = self._retrieve_properties(vim.HostSystem, host_properties)
            
            for obj in props:
                try:
                    host_data = {'hostId': str(obj.obj._moId), 'vcenterName': self.hostname}
                    prop_dict = {prop.name: prop.val for prop in obj.propSet} if obj.propSet else {}
                    
                    host_data['hostName'] = prop_dict.get('name', '')
                    
                    # CPU
                    cpu_cores = prop_dict.get('hardware.cpuInfo.numCpuCores', 0) or 0
                    cpu_sockets = prop_dict.get('hardware.cpuInfo.numCpuPackages', 0) or 0
                    cpu_threads = prop_dict.get('hardware.cpuInfo.numCpuThreads', 0) or 0
                    cpu_hz = prop_dict.get('hardware.cpuInfo.hz', 0) or 0
                    cpu_mhz = round(cpu_hz / 1000000) if cpu_hz else 0
                    
                    host_data['cpuCores'] = str(cpu_cores)
                    host_data['cpuSockets'] = str(cpu_sockets)
                    host_data['cpuThreads'] = str(cpu_threads)
                    host_data['cpuMhz'] = str(cpu_mhz)
                    
                    # CPU Model
                    cpu_pkg = prop_dict.get('hardware.cpuPkg', [])
                    cpu_model = ''
                    if cpu_pkg and len(cpu_pkg) > 0:
                        cpu_model = getattr(cpu_pkg[0], 'description', '') or ''
                    host_data['cpuModel'] = cpu_model
                    
                    # Memory
                    mem_bytes = prop_dict.get('hardware.memorySize', 0) or 0
                    mem_gb = round(mem_bytes / (1024**3))
                    host_data['memoryGB'] = str(mem_gb)
                    
                    # Usage
                    cpu_usage_mhz = prop_dict.get('summary.quickStats.overallCpuUsage', 0) or 0
                    mem_usage_mb = prop_dict.get('summary.quickStats.overallMemoryUsage', 0) or 0
                    
                    total_cpu_mhz = cpu_cores * cpu_mhz if cpu_cores and cpu_mhz else 0
                    cpu_pct = min(round((cpu_usage_mhz / total_cpu_mhz) * 100), 100) if total_cpu_mhz > 0 else 0
                    mem_pct = min(round((mem_usage_mb / 1024 / mem_gb) * 100), 100) if mem_gb > 0 else 0
                    
                    host_data['cpuUsageMhz'] = str(cpu_usage_mhz)
                    host_data['cpuUsagePct'] = str(cpu_pct)
                    host_data['memoryUsageMB'] = str(mem_usage_mb)
                    host_data['memoryUsagePct'] = str(mem_pct)
                    
                    # Hardware info
                    host_data['manufacturer'] = prop_dict.get('hardware.systemInfo.vendor', '') or ''
                    host_data['model'] = prop_dict.get('hardware.systemInfo.model', '') or ''
                    host_data['uuid'] = prop_dict.get('hardware.systemInfo.uuid', '') or ''
                    host_data['biosVersion'] = prop_dict.get('hardware.biosInfo.biosVersion', '') or ''
                    host_data['serialNumber'] = ''  # Requires deeper lookup
                    
                    # ESXi version
                    host_data['esxiVersion'] = prop_dict.get('summary.config.product.version', '') or ''
                    host_data['esxiBuild'] = prop_dict.get('summary.config.product.build', '') or ''
                    host_data['esxiFullName'] = prop_dict.get('summary.config.product.fullName', '') or ''
                    
                    # Status
                    conn_state = str(prop_dict.get('runtime.connectionState', 'Unknown'))
                    conn_state = 'Connected' if 'connected' in conn_state.lower() else conn_state
                    power_state = str(prop_dict.get('runtime.powerState', 'Unknown'))
                    power_state = 'On' if 'poweredOn' in power_state else 'Off' if 'poweredOff' in power_state else power_state
                    
                    host_data['status'] = {'Value': conn_state}
                    host_data['powerState'] = {'Value': power_state}
                    host_data['inMaintenanceMode'] = 'Yes' if prop_dict.get('runtime.inMaintenanceMode') else 'No'
                    
                    # Boot time
                    boot_time = prop_dict.get('runtime.bootTime')
                    host_data['bootTime'] = str(boot_time) if boot_time else ''
                    
                    # Location
                    parent = prop_dict.get('parent')
                    cluster_name = ''
                    datacenter_name = ''
                    while parent:
                        if isinstance(parent, vim.ClusterComputeResource):
                            cluster_name = parent.name
                        elif isinstance(parent, vim.Datacenter):
                            datacenter_name = parent.name
                            break
                        parent = getattr(parent, 'parent', None)
                    host_data['cluster'] = cluster_name
                    host_data['datacenter'] = datacenter_name
                    
                    # Counts
                    vms = prop_dict.get('vm', [])
                    datastores = prop_dict.get('datastore', [])
                    host_data['vmCount'] = str(len(vms) if vms else 0)
                    host_data['datastoreCount'] = str(len(datastores) if datastores else 0)
                    
                    hosts.append(host_data)
                    
                except Exception as e:
                    print(f"[FAST] Error processing host: {e}")
                    continue
            
            elapsed = round(time.time() - start_time, 1)
            print(f"[FAST] ✓ Collected {len(hosts)} hosts from {self.hostname} in {elapsed}s")
            
        except Exception as e:
            print(f"[FAST] ✗ Error collecting hosts: {e}")
        
        return hosts
    
    def get_all_datastores_fast(self):
        """Get all datastores using PropertyCollector"""
        datastores = []
        start_time = time.time()
        
        ds_properties = [
            'name',
            'summary.type',
            'summary.capacity',
            'summary.freeSpace',
            'summary.accessible',
            'summary.maintenanceMode',
            'summary.multipleHostAccess',
            'summary.url',
            'host',
            'vm',
        ]
        
        try:
            print(f"[FAST] Collecting Datastores from {self.hostname}...")
            props = self._retrieve_properties(vim.Datastore, ds_properties)
            
            for obj in props:
                try:
                    ds_data = {'datastoreId': str(obj.obj._moId), 'vcenterName': self.hostname}
                    prop_dict = {prop.name: prop.val for prop in obj.propSet} if obj.propSet else {}
                    
                    ds_data['datastoreName'] = prop_dict.get('name', '')
                    ds_data['type'] = prop_dict.get('summary.type', '') or ''
                    
                    capacity = prop_dict.get('summary.capacity', 0) or 0
                    free_space = prop_dict.get('summary.freeSpace', 0) or 0
                    capacity_gb = round(capacity / (1024**3))
                    free_gb = round(free_space / (1024**3))
                    used_gb = capacity_gb - free_gb
                    usage_pct = round((used_gb / capacity_gb) * 100) if capacity_gb > 0 else 0
                    
                    ds_data['capacityGB'] = str(capacity_gb)
                    ds_data['freeSpaceGB'] = str(free_gb)
                    ds_data['usedSpaceGB'] = str(used_gb)
                    ds_data['usagePct'] = str(usage_pct)
                    
                    accessible = prop_dict.get('summary.accessible', True)
                    ds_data['accessible'] = {'Value': 'Yes' if accessible else 'No'}
                    
                    hosts = prop_dict.get('host', [])
                    vms = prop_dict.get('vm', [])
                    ds_data['hostCount'] = str(len(hosts) if hosts else 0)
                    ds_data['vmCount'] = str(len(vms) if vms else 0)
                    
                    datastores.append(ds_data)
                    
                except Exception as e:
                    print(f"[FAST] Error processing datastore: {e}")
                    continue
            
            elapsed = round(time.time() - start_time, 1)
            print(f"[FAST] ✓ Collected {len(datastores)} datastores from {self.hostname} in {elapsed}s")
            
        except Exception as e:
            print(f"[FAST] ✗ Error collecting datastores: {e}")
        
        return datastores
    
    def get_all_networks_fast(self):
        """Get all networks using PropertyCollector"""
        networks = []
        start_time = time.time()
        
        net_properties = ['name', 'summary.accessible', 'host', 'vm']
        
        try:
            print(f"[FAST] Collecting Networks from {self.hostname}...")
            props = self._retrieve_properties(vim.Network, net_properties)
            
            for obj in props:
                try:
                    net_data = {'networkId': str(obj.obj._moId), 'vcenterName': self.hostname}
                    prop_dict = {prop.name: prop.val for prop in obj.propSet} if obj.propSet else {}
                    
                    net_data['networkName'] = prop_dict.get('name', '')
                    net_data['type'] = 'Distributed' if isinstance(obj.obj, vim.dvs.DistributedVirtualPortgroup) else 'Standard'
                    
                    accessible = True
                    summary = prop_dict.get('summary.accessible')
                    if summary is not None:
                        accessible = summary
                    net_data['accessible'] = {'Value': 'Yes' if accessible else 'No'}
                    
                    hosts = prop_dict.get('host', [])
                    vms = prop_dict.get('vm', [])
                    net_data['hostCount'] = str(len(hosts) if hosts else 0)
                    net_data['vmCount'] = str(len(vms) if vms else 0)
                    
                    networks.append(net_data)
                    
                except Exception as e:
                    continue
            
            elapsed = round(time.time() - start_time, 1)
            print(f"[FAST] ✓ Collected {len(networks)} networks from {self.hostname} in {elapsed}s")
            
        except Exception as e:
            print(f"[FAST] ✗ Error collecting networks: {e}")
        
        return networks


def collect_vcenter_data_parallel(credentials_list, max_workers=4):
    """
    Collect data from multiple vCenters in parallel
    
    Args:
        credentials_list: List of dicts with hostname, username, password
        max_workers: Number of parallel threads
    
    Returns:
        Dict with all collected data
    """
    all_vms = []
    all_hosts = []
    all_datastores = []
    all_networks = []
    all_vcenters = []
    
    lock = threading.Lock()
    
    def collect_from_vcenter(cred):
        """Collect all data from a single vCenter"""
        hostname = cred['hostname']
        collector = FastVCenterCollector(hostname, cred['username'], cred['password'])
        
        local_data = {
            'vms': [],
            'hosts': [],
            'datastores': [],
            'networks': [],
            'vcenter': None
        }
        
        if collector.connect():
            try:
                local_data['vms'] = collector.get_all_vms_fast()
                local_data['hosts'] = collector.get_all_hosts_fast()
                local_data['datastores'] = collector.get_all_datastores_fast()
                local_data['networks'] = collector.get_all_networks_fast()
                
                local_data['vcenter'] = {
                    'hostname': hostname,
                    'name': hostname,
                    'status': {'Value': 'Connected'},
                    'vmCount': str(len(local_data['vms'])),
                    'hostCount': str(len(local_data['hosts']))
                }
            except Exception as e:
                print(f"[PARALLEL] Error collecting from {hostname}: {e}")
                local_data['vcenter'] = {
                    'hostname': hostname,
                    'name': hostname,
                    'status': {'Value': 'Error'},
                    'vmCount': '0',
                    'hostCount': '0'
                }
            finally:
                collector.disconnect()
        else:
            local_data['vcenter'] = {
                'hostname': hostname,
                'name': hostname,
                'status': {'Value': 'Disconnected'},
                'vmCount': '0',
                'hostCount': '0'
            }
        
        return local_data
    
    start_time = time.time()
    print(f"\n[PARALLEL] Starting parallel collection from {len(credentials_list)} vCenters...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(collect_from_vcenter, cred): cred for cred in credentials_list}
        
        for future in as_completed(futures):
            cred = futures[future]
            try:
                data = future.result()
                with lock:
                    all_vms.extend(data['vms'])
                    all_hosts.extend(data['hosts'])
                    all_datastores.extend(data['datastores'])
                    all_networks.extend(data['networks'])
                    if data['vcenter']:
                        all_vcenters.append(data['vcenter'])
            except Exception as e:
                print(f"[PARALLEL] Exception from {cred['hostname']}: {e}")
    
    elapsed = round(time.time() - start_time, 1)
    print(f"\n[PARALLEL] ✓ Collection complete in {elapsed}s")
    print(f"  VMs: {len(all_vms)}")
    print(f"  Hosts: {len(all_hosts)}")
    print(f"  Datastores: {len(all_datastores)}")
    print(f"  Networks: {len(all_networks)}")
    
    return {
        'vms': all_vms,
        'hosts': all_hosts,
        'datastores': all_datastores,
        'networks': all_networks,
        'vcenters': all_vcenters
    }