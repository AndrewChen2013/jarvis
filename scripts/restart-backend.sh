#!/bin/bash
# Copyright (c) 2026 BillChen
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

# Restart jarvis backend service
# launchd will auto-restart after kill due to KeepAlive config

LOG_FILE="/Users/bill/jarvis/logs/restart.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$DATE] Restarting jarvis backend..." >> "$LOG_FILE"

# Get current PID
OLD_PID=$(lsof -ti :8000 2>/dev/null)

if [ -n "$OLD_PID" ]; then
    echo "[$DATE] Killing process $OLD_PID" >> "$LOG_FILE"
    kill "$OLD_PID" 2>/dev/null
else
    echo "[$DATE] No running process found" >> "$LOG_FILE"
    exit 0
fi

# Wait for launchd to auto-restart (ThrottleInterval is 10s + startup time)
sleep 15

# Verify
NEW_PID=$(lsof -ti :8000 2>/dev/null)
if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$OLD_PID" ]; then
    echo "[$DATE] Restart successful, new PID: $NEW_PID" >> "$LOG_FILE"
else
    echo "[$DATE] Warning: service may not have restarted properly" >> "$LOG_FILE"
fi
