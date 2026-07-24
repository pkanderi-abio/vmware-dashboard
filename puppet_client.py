#!/usr/bin/env python3
"""
Puppet Client - Query PuppetDB API v4 for node facts and reports
Uses PuppetDB REST API directly (port 8081) instead of Puppetboard scraping.
"""

import logging
import os
from typing import Any, Dict, Optional

import requests
import urllib3

logger = logging.getLogger(__name__)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Set PUPPETDB_URL in your environment or .env file
PUPPETDB_BASE = os.environ.get(
    "PUPPETDB_URL",
    "https://your-puppetdb-host:8081/pdb/query/v4",
)

# Opt-in SSL verification: set VM_SSL_CA_BUNDLE=/path/to/ca.pem to enable
# hostname/chain checks. Unset → unverified TLS (default, for internal-CA envs).
SSL_CA_BUNDLE = os.environ.get("VM_SSL_CA_BUNDLE") or False


class PuppetClient:
    """Client for querying PuppetDB API v4"""

    def __init__(self, base_url: str = PUPPETDB_BASE):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.verify = SSL_CA_BUNDLE
        self.timeout = 15

    def _get(self, path: str, params: dict = None) -> Optional[Any]:
        try:
            r = self.session.get(f"{self.base_url}{path}", params=params, timeout=self.timeout)
            if r.ok:
                return r.json()
        except Exception as e:
            logger.error(f"[PUPPET] GET {path} error: {e}")
        return None

    def get_node(self, certname: str) -> Optional[Dict]:
        """Get node metadata from PuppetDB"""
        return self._get(f"/nodes/{certname}")

    def get_node_facts(self, certname: str) -> Dict[str, Any]:
        """Get facts for a node as a flat dict"""
        data = self._get(f"/nodes/{certname}/facts")
        if not data:
            return {}
        return {item['name']: item['value'] for item in data}

    def get_latest_report(self, certname: str) -> Optional[Dict]:
        """Get the most recent report for a node"""
        data = self._get("/reports", params={
            "query": f'["=", "certname", "{certname}"]',
            "limit": 1,
            "order_by": '[{"field": "receive_time", "order": "desc"}]',
        })
        if data and len(data) > 0:
            return data[0]
        return None

    def get_puppet_data(self, hostname: str) -> Optional[Dict[str, Any]]:
        """Get all Puppet data for a node — returns None if not found in PuppetDB"""
        node = self.get_node(hostname)
        if not node:
            return None

        # Consider deactivated/expired nodes as not found
        if node.get('deactivated') or node.get('expired'):
            return None

        facts = self.get_node_facts(hostname)
        if not facts:
            return None

        puppet_data: Dict[str, Any] = {
            'puppet_found': True,
            'puppet_certname': hostname,
            'puppet_environment': node.get('facts_environment') or node.get('report_environment') or '',
            'puppet_role': facts.get('role', ''),
            'puppet_fqdn': facts.get('fqdn', ''),
            'puppet_domain': facts.get('domain', ''),
            'puppet_os_name': '',
            'puppet_os_family': '',
            'puppet_os_release': '',
            'puppet_kernel': facts.get('kernel', ''),
            'puppet_kernelversion': facts.get('kernelversion', ''),
            'puppet_virtual': facts.get('virtual', ''),
            'puppet_is_virtual': facts.get('is_virtual', True),
            'puppet_memory_total': '',
            'puppet_memory_used': '',
            'puppet_ipaddress': facts.get('ipaddress', ''),
            'puppet_netmask': facts.get('netmask', ''),
            'puppet_macaddress': facts.get('macaddress', ''),
            'puppet_uptime': facts.get('uptime', ''),
            'puppet_agent_version': facts.get('aio_agent_version', ''),
            'puppet_uuid': facts.get('uuid', ''),
            'puppet_last_report': '',
            'puppet_last_status': node.get('latest_report_status') or '',
            'puppet_last_resources': 0,
            'puppet_last_failures': 0,
            'puppet_facts_timestamp': node.get('facts_timestamp', ''),
            'puppet_report_timestamp': node.get('report_timestamp', ''),
        }

        # Parse OS info
        os_info = facts.get('os', {})
        if isinstance(os_info, dict):
            puppet_data['puppet_os_name'] = os_info.get('name', '')
            puppet_data['puppet_os_family'] = os_info.get('family', '')
            release = os_info.get('release', {})
            if isinstance(release, dict):
                puppet_data['puppet_os_release'] = release.get('full', '')

        # Parse memory
        memory = facts.get('memory', {})
        if isinstance(memory, dict):
            system = memory.get('system', {})
            if isinstance(system, dict):
                puppet_data['puppet_memory_total'] = system.get('total', '')
                puppet_data['puppet_memory_used'] = system.get('used', '')

        # Parse trusted certname
        trusted = facts.get('trusted', {})
        if isinstance(trusted, dict):
            puppet_data['puppet_certname'] = trusted.get('certname', hostname)

        # Get latest report details
        report = self.get_latest_report(hostname)
        if report:
            puppet_data['puppet_last_report'] = report.get('receive_time', report.get('start_time', ''))
            puppet_data['puppet_last_status'] = report.get('status', puppet_data['puppet_last_status'])
            puppet_data['puppet_agent_version'] = report.get('puppet_version', puppet_data['puppet_agent_version'])

            # Extract resource/failure counts from metrics
            metrics_data = report.get('metrics', {}).get('data', [])
            for m in metrics_data:
                if m.get('category') == 'resources':
                    if m.get('name') == 'total':
                        puppet_data['puppet_last_resources'] = m.get('value', 0)
                    elif m.get('name') == 'failed':
                        puppet_data['puppet_last_failures'] = m.get('value', 0)

        return puppet_data


# Singleton instance
puppet_client = PuppetClient()


if __name__ == "__main__":
    test_host = "your-node-hostname.example.com"
    logger.info(f"Testing PuppetDB for {test_host}...")
    data = puppet_client.get_puppet_data(test_host)
    if data:
        logger.info("Success!")
        for key, value in data.items():
            if value:
                logger.info(f"  {key}: {value}")
    else:
        logger.info("Not found in PuppetDB")
