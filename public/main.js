const chatHistory = document.getElementById('chatHistory');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const thinkingLevel = document.getElementById('thinkingLevel');
const usageInfo = document.getElementById('usageInfo');

const openLoginBtn = document.getElementById('openLoginBtn');
const openRegisterBtn = document.getElementById('openRegisterBtn');
const logoutBtn = document.getElementById('logoutBtn');
const adminLinkBtn = document.getElementById('adminLinkBtn');
const statusText = document.getElementById('statusText');

const authModal = document.getElementById('authModal');
const closeAuthModal = document.getElementById('closeAuthModal');
const authTitle = document.getElementById('authTitle');
const authForm = document.getElementById('authForm');
const fullNameInput = document.getElementById('fullNameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const toggleAuthModeBtn = document.getElementById('toggleAuthModeBtn');
const authHint = document.getElementById('authHint');
const planButtons = document.querySelectorAll('.plan-btn');

const navNewChat = document.getElementById('navNewChat');
const navSearch = document.getElementById('navSearch');
const navChats = document.getElementById('navChats');
const navProjects = document.getElementById('navProjects');
const navArtifacts = document.getElementById('navArtifacts');
const planPillBtn = document.getElementById('planPillBtn');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const sidebar = document.querySelector('.sidebar');

let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
  sessionId = 'session_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('sessionId', sessionId);
}

let currentImage = null;
let authMode = 'login';
let config = null;
let accessToken = localStorage.getItem('auth_access_token') || null;
let refreshToken = localStorage.getItem('auth_refresh_token') || null;
let currentProfile = null;

const friendlyQuotaMessage = 'AI provider rate limit exceeded. Please retry shortly.';

const pricingModal = document.getElementById('pricingModal');
const closePricingModal = document.getElementById('closePricingModal');

if (mobileNavToggle && sidebar) {
  mobileNavToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 980 && sidebar.classList.contains('active')) {
      if (!sidebar.contains(e.target) && e.target !== mobileNavToggle) {
        sidebar.classList.remove('active');
      }
    }
  });
}

const tryParseJson = (value) => {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const showToast = (message, type = 'info') => {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
};

const normalizeErrorMessage = (value) => {
  if (!value) return 'Request failed.';
  const text = typeof value === 'string' ? value : (value.message || JSON.stringify(value));
  const parsed = tryParseJson(text);
  const nestedMessage = parsed?.error?.message || parsed?.message || text;
  const normalized = String(nestedMessage);
  const lower = normalized.toLowerCase();

  if (lower.includes('resource_exhausted') || lower.includes('quota exceeded') || lower.includes('too many requests')) {
    return friendlyQuotaMessage;
  }

  return normalized;
};

const botAvatarHtml = `
<img src="myface.jpg" class="bot-face-img" alt="AI Avatar">
`;

const inferMimeTypeFromBase64 = (base64) => {
  const signature = String(base64 || '').slice(0, 16);
  if (signature.startsWith('iVBORw0KGgo')) return 'image/png';
  if (signature.startsWith('/9j/')) return 'image/jpeg';
  if (signature.startsWith('R0lGOD')) return 'image/gif';
  if (signature.startsWith('UklGR')) return 'image/webp';
  if (signature.startsWith('Qk')) return 'image/bmp';
  return null;
};

const buildImagePayload = (rawDataUrl, fallbackMimeType = '') => {
  const source = String(rawDataUrl || '');
  const dataUrlMatch = source.match(/^data:([^;]+);base64,(.+)$/i);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : source;

  let mimeType = String(fallbackMimeType || '').trim().toLowerCase();
  if (!mimeType || mimeType === 'image') {
    mimeType = dataUrlMatch?.[1]?.toLowerCase?.() || '';
  }
  if (!mimeType.startsWith('image/')) {
    const inferred = inferMimeTypeFromBase64(base64);
    if (inferred) mimeType = inferred;
  }
  if (!mimeType.startsWith('image/')) return null;

  return { data: base64, mimeType };
};

const isImageLikeFile = (file) => {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(file.name || ''));
};

// Clipboard image paste support
messageInput.addEventListener('paste', (e) => {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (evt) => {
        const payload = buildImagePayload(evt.target.result, item.type);
        if (!payload) {
          showToast('Pasted image could not be processed. Try PNG or JPEG.', 'error');
          return;
        }
        currentImage = payload;
        imagePreview.src = evt.target.result;
        imagePreviewContainer.style.display = 'inline-block';
        updateUIState();
      };
      reader.readAsDataURL(file);
    }
  }
});

// Artifact and Code Download Helper
const downloadFile = (filename, content) => {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const extractArtifacts = (text) => {
  const artifacts = [];
  const lines = text.split('\n');
  let currentFile = null;
  let currentContent = [];
  let isCollecting = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('FILE:')) {
      currentFile = line.replace('FILE:', '').trim();
      isCollecting = false;
      currentContent = [];
    } else if (line.startsWith('```') && currentFile) {
      if (!isCollecting) {
        isCollecting = true;
      } else {
        isCollecting = false;
        artifacts.push({ filename: currentFile, content: currentContent.join('\n') });
        currentFile = null;
      }
    } else if (isCollecting) {
      currentContent.push(lines[i]);
    }
  }
  return artifacts;
};

const appendMessage = (role, text, image = null) => {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  if (role === 'model' || role === 'system') {
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'avatar';
    avatarDiv.innerHTML = botAvatarHtml;
    messageDiv.appendChild(avatarDiv);
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (image) {
    const img = document.createElement('img');
    img.src = `data:${image.mimeType};base64,${image.data}`;
    img.className = 'message-image';
    contentDiv.appendChild(img);
  }

  if (text) {
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    contentDiv.appendChild(textSpan);
    
    // Check for artifacts in AI responses
    if (role === 'model') {
      const artifacts = extractArtifacts(text);
      if (artifacts.length > 0) {
        const downloadContainer = document.createElement('div');
        downloadContainer.style.marginTop = '12px';
        downloadContainer.style.display = 'flex';
        downloadContainer.style.gap = '8px';
        downloadContainer.style.flexWrap = 'wrap';

        artifacts.forEach(art => {
          const btn = document.createElement('button');
          btn.className = 'ghost-btn';
          btn.style.fontSize = '11px';
          btn.innerHTML = `💾 Download ${art.filename}`;
          btn.onclick = () => downloadFile(art.filename, art.content);
          downloadContainer.appendChild(btn);
        });

        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'nav-btn-primary';
        downloadAllBtn.style.padding = '4px 10px';
        downloadAllBtn.style.fontSize = '11px';
        downloadAllBtn.style.borderRadius = '6px';
        downloadAllBtn.innerHTML = '📦 Download Project';
        downloadAllBtn.onclick = () => {
          artifacts.forEach(art => downloadFile(art.filename, art.content));
          showToast('Project files downloaded!');
        };
        downloadContainer.appendChild(downloadAllBtn);
        contentDiv.appendChild(downloadContainer);
      }
    }
  }

  messageDiv.appendChild(contentDiv);
  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return contentDiv;
};

const setAuthMode = (mode) => {
  authMode = mode;
  if (mode === 'register') {
    authTitle.textContent = 'Register';
    authSubmitBtn.textContent = 'Create Account';
    authHint.textContent = 'Register requires email verification before login.';
    toggleAuthModeBtn.textContent = 'Switch to Login';
    fullNameInput.style.display = 'block';
  } else {
    authTitle.textContent = 'Login';
    authSubmitBtn.textContent = 'Login';
    authHint.textContent = 'No account? Register and verify your email first.';
    toggleAuthModeBtn.textContent = 'Switch to Register';
    fullNameInput.style.display = 'none';
  }
};

const openAuthModal = (mode) => {
  setAuthMode(mode);
  authModal.classList.remove('hidden');
};

const closeModal = () => {
  authModal.classList.add('hidden');
  authForm.reset();
};

const saveTokens = (nextAccessToken, nextRefreshToken) => {
  accessToken = nextAccessToken || null;
  refreshToken = nextRefreshToken || null;

  if (accessToken) localStorage.setItem('auth_access_token', accessToken);
  else localStorage.removeItem('auth_access_token');

  if (refreshToken) localStorage.setItem('auth_refresh_token', refreshToken);
  else localStorage.removeItem('auth_refresh_token');
};

const refreshAuthState = async () => {
  try {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const response = await fetch('/chat/auth/me', { headers });
    const data = await response.json();
    currentProfile = data;

    if (data.authenticated) {
      statusText.textContent = `${data.user.email} · ${data.planType}`;
      openLoginBtn.style.display = 'none';
      openRegisterBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-flex';
      adminLinkBtn.style.display = 'inline-flex';
      usageInfo.textContent = data.planType === 'free' ? 'Registered plan: Unlimited requests' : `Plan: ${data.planType}`;
    } else {
      statusText.textContent = 'Guest mode';
      openLoginBtn.style.display = 'inline-flex';
      openRegisterBtn.style.display = 'inline-flex';
      logoutBtn.style.display = 'none';
      adminLinkBtn.style.display = 'none';
      usageInfo.textContent = 'Guest mode: Unlimited requests';
    }

    if (!response.ok) {
      saveTokens(null, null);
    }
  } catch (error) {
    saveTokens(null, null);
    currentProfile = { authenticated: false, planType: 'guest', limits: null };
    statusText.textContent = 'Guest mode';
    openLoginBtn.style.display = 'inline-flex';
    openRegisterBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
    adminLinkBtn.style.display = 'none';
    usageInfo.textContent = 'Guest mode: Unlimited requests';
    console.error('Auth state refresh failed:', error);
  }
};

const initAuthConfig = async () => {
  try {
    const response = await fetch('/chat/public-config');
    config = await response.json();

    if (!config?.supabase?.url || !config?.supabase?.publishableKey) {
      appendMessage('system', 'Auth is not configured yet. Chat will run in guest mode.');
      return;
    }

    await refreshAuthState();
  } catch (error) {
    console.error('Auth initialization failed:', error);
  }
};

const updateUIState = () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  sendBtn.disabled = messageInput.value.trim() === '' && !currentImage;
};

const startNewChat = () => {
  chatHistory.innerHTML = '';
  sessionId = 'session_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('sessionId', sessionId);
  appendMessage('system', 'Started a new chat.');
};

const wireSidebarButtons = () => {
  navNewChat.addEventListener('click', startNewChat);
  navSearch.addEventListener('click', () => messageInput.focus());
  navChats.addEventListener('click', () => chatHistory.scrollTo({ top: 0, behavior: 'smooth' }));
  navProjects.addEventListener('click', () => pricingModal.classList.remove('hidden'));
  navArtifacts.addEventListener('click', () => { window.location.href = '/admin.html'; });
  planPillBtn.addEventListener('click', () => pricingModal.classList.remove('hidden'));
};

closePricingModal.addEventListener('click', () => {
  pricingModal.classList.add('hidden');
});

messageInput.addEventListener('input', updateUIState);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (messageInput.value.trim() || currentImage) {
      chatForm.dispatchEvent(new Event('submit'));
    }
  }
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!isImageLikeFile(file)) {
    showToast('Please upload a valid image.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    const payload = buildImagePayload(evt.target.result, file.type);
    if (!payload) {
      showToast('Image format is not supported. Use PNG, JPG, WEBP, GIF, or BMP.', 'error');
      return;
    }
    currentImage = payload;
    imagePreview.src = evt.target.result;
    imagePreviewContainer.style.display = 'inline-block';
    updateUIState();
  };
  reader.readAsDataURL(file);
});

removeImageBtn.addEventListener('click', () => {
  currentImage = null;
  imagePreview.src = '';
  imagePreviewContainer.style.display = 'none';
  fileInput.value = '';
  updateUIState();
});

openLoginBtn.addEventListener('click', () => openAuthModal('login'));
openRegisterBtn.addEventListener('click', () => openAuthModal('register'));
closeAuthModal.addEventListener('click', closeModal);
toggleAuthModeBtn.addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

logoutBtn.addEventListener('click', async () => {
  saveTokens(null, null);
  await refreshAuthState();
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!config?.supabase?.url || !config?.supabase?.publishableKey) {
    showToast('Supabase auth is not configured.', 'error');
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    if (authMode === 'register') {
      const fullName = fullNameInput.value.trim();
      const response = await fetch('/chat/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Registration failed.');
      showToast('Registration successful! You can now log in.', 'success');
      setAuthMode('login');
      closeModal();
      return;
    }

    const response = await fetch('/chat/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Login failed.');

    saveTokens(data.session?.access_token, data.session?.refresh_token);
    showToast('Login successful!', 'success');
    closeModal();
    await refreshAuthState();
  } catch (error) {
    showToast(error.message || 'Authentication failed.', 'error');
  }
});

planButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!accessToken) {
      openAuthModal('login');
      return;
    }
    const plan = btn.dataset.plan;
    const qrSrc = btn.dataset.qr;
    const priceText = btn.dataset.price;
    
    selectedPlanInput.value = plan;
    qrImage.src = qrSrc;
    paymentAmountText.textContent = `Amount to pay: ${priceText}`;
    paymentModal.classList.remove('hidden');
  });
});

closePaymentModal.addEventListener('click', () => {
  paymentModal.classList.add('hidden');
  paymentForm.reset();
});

paymentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const plan = selectedPlanInput.value;
  const referenceNote = referenceInput.value.trim();
  
  try {
    const response = await fetch('/chat/subscription/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ plan, referenceNote, sessionId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to submit payment reference.');
    
    showToast('Payment submitted! Awaiting admin approval.', 'success');
    paymentModal.classList.add('hidden');
    paymentForm.reset();
  } catch (error) {
    showToast(error.message, 'error');
  }
});

trackPaymentBtn.addEventListener('click', async () => {
  if (!accessToken) {
    showToast('Please log in to track your payment status.', 'error');
    return;
  }
  try {
    const response = await fetch('/chat/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (data.profile && data.profile.plan_status) {
      showToast(`Current Plan: ${data.profile.plan || 'Free'} | Status: ${data.profile.plan_status.toUpperCase()}`, 'info');
    } else {
      showToast('No pending payments found.', 'info');
    }
  } catch (error) {
    showToast('Could not fetch status.', 'error');
  }
});

// Audio notification for message completion
let globalAudioContext = null;
const playCompletionSound = () => {
  try {
    if (!globalAudioContext) {
      globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (globalAudioContext.state === 'suspended') {
      globalAudioContext.resume();
    }
    
    const oscillator = globalAudioContext.createOscillator();
    const gainNode = globalAudioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, globalAudioContext.currentTime); // A5 note
    oscillator.frequency.exponentialRampToValueAtTime(440, globalAudioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.1, globalAudioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, globalAudioContext.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(globalAudioContext.destination);

    oscillator.start();
    oscillator.stop(globalAudioContext.currentTime + 0.1);
  } catch (e) {
    console.warn('Audio feedback failed', e);
  }
};

// Welcome Voice Over and Music
let welcomeAudioStarted = false;
const startWelcomeAudio = () => {
  if (welcomeAudioStarted) return;
  welcomeAudioStarted = true;

  // Ensure AudioContext is initialized/resumed on first gesture
  if (!globalAudioContext) {
    globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (globalAudioContext.state === 'suspended') {
    globalAudioContext.resume();
  }

  // Background Music
  const bgMusic = new Audio('https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3');
  bgMusic.volume = 0.1;
  bgMusic.loop = true;
  // Use a slight delay to ensure the browser registers the gesture for multiple audio sources
  setTimeout(() => {
    bgMusic.play().catch(e => console.warn('Background music failed to play:', e));
  }, 50);

  // Voice Over using Web Speech API
  // On mobile, we MUST call speak() directly in the event handler to preserve the gesture
  const msg = new SpeechSynthesisUtterance("Welcome to SpeedAI. Register and verify your email for unlimited low-thinking chat");
  const voices = window.speechSynthesis.getVoices();
  // Try to find a clear English voice
  const selectedVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('English')) && v.lang.startsWith('en')) || voices[0];
  if (selectedVoice) msg.voice = selectedVoice;
  msg.rate = 0.9;
  msg.pitch = 1;
  window.speechSynthesis.speak(msg);
};

// Trigger on first user interaction (click or touch)
['click', 'touchstart', 'keydown'].forEach(evt => {
  document.addEventListener(evt, startWelcomeAudio, { once: true });
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (!message && !currentImage) return;

  const sentImage = currentImage;
  messageInput.value = '';
  messageInput.style.height = 'auto';
  currentImage = null;
  imagePreviewContainer.style.display = 'none';
  imagePreview.src = '';
  fileInput.value = '';
  sendBtn.disabled = true;

  appendMessage('user', message, sentImage);
  const botContentDiv = appendMessage('model', '');
  botContentDiv.parentElement.classList.add('loading');
  
  if (thinkingLevel.value === 'image-generate') {
    botContentDiv.innerHTML = '<span class="typing-indicator" id="loadingText">generating...</span>';
    setTimeout(() => {
      const loadingText = botContentDiv.querySelector('#loadingText');
      if (loadingText && loadingText.textContent === 'generating...') {
        loadingText.textContent = 'almost done...';
      }
    }, 4000); // Change text after 4 seconds
  } else {
    botContentDiv.innerHTML = '<span class="typing-indicator">answering...</span>';
  }
  
  let fullResponse = '';
  let isFirstChunk = true;

  try {
    const response = await fetch('/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({
        sessionId,
        message: message || 'Analyze this image',
        image: sentImage,
        thinkingLevel: thinkingLevel.value
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      throw new Error(normalizeErrorMessage(errData?.error || `HTTP error ${response.status}`));
    }

    if (!response.body) throw new Error('Stream unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let pendingLine = '';

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (!value) continue;
      pendingLine += decoder.decode(value, { stream: true });
      const lines = pendingLine.split('\n');
      pendingLine = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          done = true;
          playCompletionSound();
          break;
        }
        const data = JSON.parse(dataStr);
        if (data.error) throw new Error(normalizeErrorMessage(data.error));
        if (data.text) {
          if (isFirstChunk) {
            botContentDiv.parentElement.classList.remove('loading');
            botContentDiv.innerHTML = '<span></span>';
            isFirstChunk = false;
          }

          if (data.text.startsWith('GENERATED_IMAGE:')) {
            const imageUrl = data.text.replace('GENERATED_IMAGE:', '');
            const imgContainer = document.createElement('div');
            imgContainer.style.marginTop = '10px';
            const img = document.createElement('img');
            img.src = imageUrl;
            img.className = 'message-image';
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            imgContainer.appendChild(img);
            
            botContentDiv.innerHTML = '';
            botContentDiv.appendChild(imgContainer);
            fullResponse = data.text;
          } else {
            fullResponse += data.text;
            const textSpan = botContentDiv.querySelector('span');
            textSpan.textContent = fullResponse;
          }
          chatHistory.scrollTop = chatHistory.scrollHeight;
        }
      }
    }
  } catch (error) {
    const displayError = normalizeErrorMessage(error?.message || error);
    if (!fullResponse) {
      botContentDiv.parentElement.classList.add('error');
      botContentDiv.textContent = `Error: ${displayError}`;
    } else {
      appendMessage('error', `Stream Error: ${displayError}`);
    }
  } finally {
    updateUIState();
    messageInput.focus();
    refreshAuthState().catch(() => {});
  }
});

appendMessage('system', 'Welcome to SpeedAI. Register and verify your email for unlimited low-thinking chat.');
wireSidebarButtons();
initAuthConfig().catch((error) => {
  console.error(error);
  appendMessage('error', 'Failed to load app configuration.');
});
