#!/usr/bin/env python3
# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Security Management Script

Usage:
    python scripts/security.py list          # View blacklist and security status
    python scripts/security.py unblock <ip>  # Unblock specified IP
    python scripts/security.py unlock        # Release emergency lock
    python scripts/security.py reset         # Reset all security state (clear blacklist, unlock)

Note: Login attempts are tracked in memory, not persisted to database.
      Restarting the service will clear login attempt history.
"""
import sys
import os

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from app.services.database import db


def print_status():
    """Print current security status"""
    print("\n" + "=" * 50)
    print("  Jarvis Security Status")
    print("=" * 50)

    # Emergency lock status
    locked = db.is_emergency_locked()
    status_icon = "🔴 LOCKED" if locked else "🟢 Normal"
    print(f"\nEmergency Lock: {status_icon}")

    # IP blacklist
    blocked_ips = db.get_all_blocked_ips()
    print(f"\nIP Blacklist ({len(blocked_ips)}):")
    if blocked_ips:
        print("-" * 50)
        for item in blocked_ips:
            print(f"  {item['ip']}")
            print(f"    Reason: {item['reason']}")
            print(f"    Blocked at: {item['blocked_at']}")
            print(f"    Failed attempts: {item['total_attempts']}")
            print()
    else:
        print("  (none)")

    print("\nNote: Login attempts are tracked in memory (not persisted)")
    print("=" * 50 + "\n")


def unblock_ip(ip: str):
    """Unblock specified IP"""
    if db.unblock_ip(ip):
        print(f"✅ Unblocked IP: {ip}")
    else:
        print(f"❌ IP {ip} is not in blacklist")


def unlock():
    """Release emergency lock"""
    if db.is_emergency_locked():
        db.set_emergency_lock(False)
        print("✅ Emergency lock released")
    else:
        print("ℹ️  Service is not in emergency lock state")


def reset_all():
    """Reset all security state"""
    confirm = input("⚠️  Confirm reset all security state? (yes/no): ")
    if confirm.lower() != "yes":
        print("Cancelled")
        return

    # Release emergency lock
    db.set_emergency_lock(False)

    # Clear blacklist
    blocked_ips = db.get_all_blocked_ips()
    for item in blocked_ips:
        db.unblock_ip(item["ip"])

    print(f"✅ Security state reset:")
    print(f"   - Emergency lock released")
    print(f"   - Unblocked {len(blocked_ips)} IPs")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    command = sys.argv[1].lower()

    if command == "list":
        print_status()
    elif command == "unblock":
        if len(sys.argv) < 3:
            print("Usage: python scripts/security.py unblock <ip>")
            return
        unblock_ip(sys.argv[2])
    elif command == "unlock":
        unlock()
    elif command == "reset":
        reset_all()
    else:
        print(f"Unknown command: {command}")
        print(__doc__)


if __name__ == "__main__":
    main()
