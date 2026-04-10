// 录制指示器 — 使用 Shadow DOM 避免样式冲突

export function createRecordingIndicator(): HTMLElement {
  const host = document.createElement('div')
  host.id = 'yoso-recording-indicator'
  const shadow = host.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
    <style>
      .indicator {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 2147483647;
        background: #ef4444;
        color: white;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-family: system-ui, sans-serif;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: pulse 2s infinite;
        pointer-events: none;
        user-select: none;
      }
      .indicator.paused {
        background: #f59e0b;
        animation: none;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: white;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
    </style>
    <div class="indicator" id="indicator-el">
      <span class="dot"></span>
      <span id="indicator-text">YOSO 录制中</span>
    </div>
  `

  document.body.appendChild(host)
  return host
}

export function updateIndicator(host: HTMLElement, paused: boolean): void {
  const shadow = host.shadowRoot
  if (!shadow) return
  const el = shadow.getElementById('indicator-el')
  const text = shadow.getElementById('indicator-text')
  if (el) {
    el.className = paused ? 'indicator paused' : 'indicator'
  }
  if (text) {
    text.textContent = paused ? 'YOSO 已暂停' : 'YOSO 录制中'
  }
}

export function removeIndicator(host: HTMLElement): void {
  host.remove()
}
