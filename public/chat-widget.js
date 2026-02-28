(function() {
  const STYLE = document.createElement('style');
  STYLE.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap');
    #hc-chat-bubble {
      position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
      border-radius: 50%; background: #1e1845; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #hc-chat-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.4); }
    #hc-chat-bubble svg { width: 28px; height: 28px; fill: white; }
    #hc-chat-window {
      position: fixed; bottom: 90px; right: 20px; width: 380px; height: 500px;
      border-radius: 16px; background: #faf9f6; z-index: 9999;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25); display: flex; flex-direction: column;
      overflow: hidden; font-family: 'Montserrat', sans-serif;
      opacity: 0; transform: translateY(20px) scale(0.95); pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    #hc-chat-window.open {
      opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;
    }
    #hc-chat-header {
      background: #1e1845; color: white; padding: 14px 16px; display: flex;
      align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    #hc-chat-header span { font-size: 15px; font-weight: 600; }
    #hc-chat-close {
      background: none; border: none; color: white; font-size: 22px;
      cursor: pointer; padding: 0 4px; line-height: 1;
    }
    #hc-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex;
      flex-direction: column; gap: 10px;
    }
    .hc-msg {
      max-width: 80%; padding: 10px 14px; border-radius: 14px;
      font-size: 13.5px; line-height: 1.45; word-wrap: break-word;
    }
    .hc-msg.bot {
      background: white; align-self: flex-start; color: #333;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .hc-msg.user {
      background: #c9a227; align-self: flex-end; color: white;
    }
    .hc-typing { align-self: flex-start; display: flex; gap: 4px; padding: 12px 16px; }
    .hc-typing span {
      width: 7px; height: 7px; background: #aaa; border-radius: 50%;
      animation: hcBounce 1.2s infinite;
    }
    .hc-typing span:nth-child(2) { animation-delay: 0.2s; }
    .hc-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes hcBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }
    #hc-chat-input-bar {
      display: flex; padding: 10px; border-top: 1px solid #e8e6e0; flex-shrink: 0;
      background: white;
    }
    #hc-chat-input {
      flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 8px 14px;
      font-size: 13.5px; font-family: 'Montserrat', sans-serif; outline: none;
      resize: none;
    }
    #hc-chat-input:focus { border-color: #c9a227; }
    #hc-chat-send {
      background: #c9a227; border: none; border-radius: 50%; width: 36px; height: 36px;
      margin-left: 8px; cursor: pointer; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; transition: background 0.15s;
    }
    #hc-chat-send:hover { background: #b08d1e; }
    #hc-chat-send svg { width: 16px; height: 16px; fill: white; }
    #hc-chat-footer {
      text-align: center; padding: 6px; font-size: 10px; color: #aaa;
      background: white; flex-shrink: 0;
    }
    @media (max-width: 480px) {
      #hc-chat-window {
        width: 100%; height: calc(100% - 60px); bottom: 0; right: 0;
        border-radius: 16px 16px 0 0;
      }
      #hc-chat-bubble { bottom: 14px; right: 14px; }
    }
  `;
  document.head.appendChild(STYLE);

  const BUBBLE = document.createElement('button');
  BUBBLE.id = 'hc-chat-bubble';
  BUBBLE.setAttribute('aria-label', 'Open chat');
  BUBBLE.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>';
  document.body.appendChild(BUBBLE);

  const WIN = document.createElement('div');
  WIN.id = 'hc-chat-window';
  WIN.innerHTML = `
    <div id="hc-chat-header"><span>HomeCrafter Assistant</span><button id="hc-chat-close">&times;</button></div>
    <div id="hc-chat-messages"></div>
    <div id="hc-chat-input-bar">
      <input id="hc-chat-input" type="text" placeholder="Type a message..." autocomplete="off">
      <button id="hc-chat-send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
    </div>
    <div id="hc-chat-footer">Powered by HomeCrafter</div>
  `;
  document.body.appendChild(WIN);

  const MSGS = document.getElementById('hc-chat-messages');
  const INPUT = document.getElementById('hc-chat-input');
  const SEND = document.getElementById('hc-chat-send');
  let history = [];
  let isOpen = false;

  function addMsg(text, role) {
    const d = document.createElement('div');
    d.className = 'hc-msg ' + role;
    d.textContent = text;
    MSGS.appendChild(d);
    MSGS.scrollTop = MSGS.scrollHeight;
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = 'hc-typing';
    d.id = 'hc-typing-indicator';
    d.innerHTML = '<span></span><span></span><span></span>';
    MSGS.appendChild(d);
    MSGS.scrollTop = MSGS.scrollHeight;
  }
  function hideTyping() {
    const el = document.getElementById('hc-typing-indicator');
    if (el) el.remove();
  }

  function toggle() {
    isOpen = !isOpen;
    WIN.classList.toggle('open', isOpen);
    if (isOpen && MSGS.children.length === 0) {
      addMsg("Hi! 👋 I'm the HomeCrafter assistant. Ask me anything about home improvement projects, or I can help match you with top-rated local pros.", 'bot');
    }
    if (isOpen) INPUT.focus();
  }

  async function send() {
    const text = INPUT.value.trim();
    if (!text) return;
    INPUT.value = '';
    addMsg(text, 'user');
    history.push({ role: 'user', content: text });
    showTyping();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-10) }),
      });
      const data = await res.json();
      hideTyping();
      const reply = data.reply || "Sorry, I couldn't respond right now.";
      addMsg(reply, 'bot');
      history.push({ role: 'assistant', content: reply });
    } catch(e) {
      hideTyping();
      addMsg("Sorry, something went wrong. Please try again.", 'bot');
    }
  }

  BUBBLE.addEventListener('click', toggle);
  document.getElementById('hc-chat-close').addEventListener('click', toggle);
  SEND.addEventListener('click', send);
  INPUT.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
})();
