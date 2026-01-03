/**
 * Copyright (c) 2025 BillChen
 * Monitor Module - 系统监控
 */

window.AppMonitor = {
  _monitorTimer: null,
  _monitorLoaded: false,
  _isMonitorVisible: false,

  /**
   * 获取 token
   */
  get token() {
    return localStorage.getItem('auth_token') || '';
  },

  /**
   * 初始化监控模块
   */
  initMonitor() {
    console.log('[Monitor] initMonitor called');

    // 刷新按钮
    const refreshBtn = document.getElementById('monitor-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadMonitorData());
    }

    // 排序和数量选择
    const sortSelect = document.getElementById('process-sort');
    const countSelect = document.getElementById('process-count');

    console.log('[Monitor] sortSelect:', sortSelect);
    console.log('[Monitor] countSelect:', countSelect);

    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        console.log('[Monitor] Sort changed to:', e.target.value);
        this.loadMonitorData();
      });
      console.log('[Monitor] Sort event listener added');
    }
    if (countSelect) {
      countSelect.addEventListener('change', (e) => {
        console.log('[Monitor] Count changed to:', e.target.value);
        this.loadMonitorData();
      });
      console.log('[Monitor] Count event listener added');
    }
  },

  /**
   * 加载监控页面（首次进入时调用）
   */
  loadMonitorPage() {
    if (this._monitorLoaded) return;
    this._monitorLoaded = true;
    this.loadMonitorData();
  },

  /**
   * 开始监控轮询
   */
  startMonitorPolling() {
    if (this._monitorTimer) return;
    this._isMonitorVisible = true;

    // 立即加载一次
    this.loadMonitorData();

    // 每 5 秒刷新
    this._monitorTimer = setInterval(() => {
      if (this._isMonitorVisible) {
        this.loadMonitorData();
      }
    }, 5000);
  },

  /**
   * 停止监控轮询
   */
  stopMonitorPolling() {
    this._isMonitorVisible = false;
    if (this._monitorTimer) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }
  },

  /**
   * 加载监控数据
   */
  async loadMonitorData() {
    const sortBy = document.getElementById('process-sort')?.value || 'cpu';
    const topCount = document.getElementById('process-count')?.value || '5';
    console.log('[Monitor] loadMonitorData called, sortBy:', sortBy, 'topCount:', topCount);

    try {
      const url = `/api/monitor/overview?sort_by=${sortBy}&top_count=${topCount}`;
      console.log('[Monitor] Fetching:', url);
      const response = await fetch(url,
        {
          headers: { 'Authorization': `Bearer ${this.token}` }
        }
      );

      console.log('[Monitor] API response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('[Monitor] Data received:', data);
        this.updateMonitorDisplay(data);
      } else {
        console.error('[Monitor] API error:', await response.text());
      }
    } catch (error) {
      console.error('[Monitor] Load error:', error);
    }
  },

  /**
   * 更新监控显示
   */
  updateMonitorDisplay(data) {
    this.updateCpuDisplay(data.cpu);
    this.updateMemoryDisplay(data.memory);
    this.updateDiskDisplay(data.disk);
    this.updateJarvisDisplay(data.jarvis);
    this.updateProcessList(data.top_processes);
  },

  /**
   * 更新 CPU 显示
   */
  updateCpuDisplay(cpu) {
    if (!cpu) return;

    const progress = document.getElementById('cpu-progress');
    const value = document.getElementById('cpu-value');
    const detail = document.getElementById('cpu-detail');

    if (progress) {
      progress.setAttribute('stroke-dasharray', `${cpu.percent}, 100`);
    }
    if (value) {
      value.textContent = `${cpu.percent}%`;
    }
    if (detail) {
      const loadStr = cpu.load_avg ? cpu.load_avg.join(' / ') : '--';
      detail.textContent = `${cpu.cores} cores · ${loadStr}`;
    }

    // 设置颜色
    this.setRingColor('cpu', cpu.percent);
  },

  /**
   * 更新内存显示
   */
  updateMemoryDisplay(memory) {
    if (!memory) return;

    const progress = document.getElementById('mem-progress');
    const value = document.getElementById('mem-value');
    const detail = document.getElementById('mem-detail');

    if (progress) {
      progress.setAttribute('stroke-dasharray', `${memory.percent}, 100`);
    }
    if (value) {
      value.textContent = `${memory.percent}%`;
    }
    if (detail) {
      const used = this.formatBytes(memory.used);
      const total = this.formatBytes(memory.total);
      detail.textContent = `${used} / ${total}`;
    }

    // 设置颜色
    this.setRingColor('mem', memory.percent);
  },

  /**
   * 设置环形图颜色
   */
  setRingColor(type, percent) {
    const progress = document.getElementById(`${type}-progress`);
    if (!progress) return;

    let color = '#10b981'; // 绿色
    if (percent > 80) {
      color = '#ef4444'; // 红色
    } else if (percent > 60) {
      color = '#f59e0b'; // 橙色
    }

    progress.style.stroke = color;
  },

  /**
   * 更新磁盘显示
   */
  updateDiskDisplay(disks) {
    const container = document.getElementById('disk-list');
    if (!container || !disks) return;

    if (disks.length === 0) {
      container.innerHTML = '<div class="empty-hint">No disk info</div>';
      return;
    }

    let html = '';
    for (const disk of disks) {
      const name = disk.mount === '/' ? 'System' : disk.mount.split('/').pop();
      const used = this.formatBytes(disk.used);
      const total = this.formatBytes(disk.total);
      const colorClass = disk.percent > 90 ? 'danger' : disk.percent > 75 ? 'warning' : '';

      html += `
        <div class="disk-item">
          <div class="disk-info">
            <span class="disk-name">${name}</span>
            <span class="disk-size">${used} / ${total}</span>
          </div>
          <div class="disk-bar">
            <div class="disk-bar-fill ${colorClass}" style="width: ${disk.percent}%"></div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  /**
   * 更新 Jarvis 信息（展示全部进程）
   */
  updateJarvisDisplay(info) {
    const container = document.getElementById('jarvis-info');
    if (!container || !info) return;

    const mainMem = this.formatBytes(info.main_memory);
    const totalMem = this.formatBytes(info.total_memory);

    let html = `
      <div class="process-item">
        <span class="process-name">Main (uvicorn)</span>
        <span class="process-cpu">${info.main_cpu || 0}%</span>
        <span class="process-mem">${mainMem}</span>
      </div>
    `;

    // 展示所有子进程
    if (info.terminals && info.terminals.length > 0) {
      for (const term of info.terminals) {
        const mem = this.formatBytes(term.memory);
        html += `
          <div class="process-item">
            <span class="process-name">${term.name}</span>
            <span class="process-cpu">${term.cpu}%</span>
            <span class="process-mem">${mem}</span>
          </div>
        `;
      }
    }

    // 总计
    html += `
      <div class="process-item cr-total">
        <span class="process-name">Total (${info.terminal_count + 1})</span>
        <span class="process-cpu"></span>
        <span class="process-mem">${totalMem}</span>
      </div>
    `;

    container.innerHTML = html;
  },

  /**
   * 更新进程列表
   */
  updateProcessList(processes) {
    const container = document.getElementById('process-list');
    if (!container || !processes) return;

    if (processes.length === 0) {
      container.innerHTML = '<div class="empty-hint">No processes</div>';
      return;
    }

    let html = '';
    for (const proc of processes) {
      const mem = this.formatBytes(proc.memory);
      html += `
        <div class="process-item">
          <span class="process-name">${proc.name}</span>
          <span class="process-cpu">${proc.cpu}%</span>
          <span class="process-mem">${mem}</span>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
  }
};
