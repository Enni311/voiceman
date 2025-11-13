let localStream;
let originalVideoTrack;
let currentCalls = {}; // {peerId: call}
let dataConnections = {}; // {peerId: conn}
let currentUser;
let peer = null;
let isMicOn = true;
let isCamOn = true;
let groupCallActive = false;

document.getElementById('login').style.display = 'block';

function register() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    if (!username || !password) {
        showMessage('loginMessage', 'Введите имя и пароль!', 'error');
        return;
    }
    if (localStorage.getItem('user_' + username)) {
        showMessage('loginMessage', 'Пользователь уже существует!', 'error');
    } else {
        localStorage.setItem('user_' + username, password);
        loginUser(username);
    }
}

function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    if (!username || !password) {
        showMessage('loginMessage', 'Введите имя и пароль!', 'error');
        return;
    }
    if (localStorage.getItem('user_' + username) === password) {
        loginUser(username);
    } else {
        showMessage('loginMessage', 'Неверное имя или пароль!', 'error');
    }
}

async function loginUser(username) {
    currentUser = username;
    document.getElementById('login').style.display = 'none';
    document.getElementById('chatInterface').style.display = 'block';
    document.getElementById('userLabel').innerText = username;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: { width: { ideal: 640 }, height: { ideal: 480 } }
        });
        originalVideoTrack = localStream.getVideoTracks()[0];
        initLocalVideo();
        updateLocalVideoPlaceholder();
        initPeer();
        // Set button states after login
        document.getElementById('micBtn').innerText = '🔊 Микрофон';
        document.getElementById('camBtn').innerText = '📹 Камера';
    } catch (e) {
        alert('Ошибка доступа к камере/микрофону: ' + e.message);
    }
}

function initLocalVideo() {
    const container = document.getElementById('videosContainer');
    const wrapper = createVideoWrapper(currentUser, true);
    const video = document.createElement('video');
    video.id = 'localVideo';
    video.autoplay = true;
    video.muted = true;
    video.srcObject = localStream;
    wrapper.appendChild(video);
    container.insertBefore(wrapper, container.firstChild);
}

function createVideoWrapper(username, isLocal = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'videoWrapper';
    const label = document.createElement('div');
    label.className = 'usernameLabel';
    label.textContent = username;
    wrapper.appendChild(label);
    return wrapper;
}

function addRemoteVideo(peerId, stream, username) {
    const container = document.getElementById('videosContainer');
    let wrapper = container.querySelector(`[data-peer="${peerId}"]`);
    if (!wrapper) {
        wrapper = createVideoWrapper(username, false);
        wrapper.dataset.peer = peerId;
        container.appendChild(wrapper);
    }
    const video = document.createElement('video');
    video.id = `remoteVideo_${peerId}`;
    video.autoplay = true;
    video.srcObject = stream;
    const placeholder = wrapper.querySelector('.noVideo');
    if (placeholder) placeholder.remove();
    wrapper.appendChild(video);
}

function removeRemoteVideo(peerId) {
    const wrapper = document.getElementById('videosContainer').querySelector(`[data-peer="${peerId}"]`);
    if (wrapper) wrapper.remove();
}

function toggleMic() {
    if (localStream && localStream.getAudioTracks()[0]) {
        isMicOn = !isMicOn;
        localStream.getAudioTracks()[0].enabled = isMicOn;
        document.getElementById('micBtn').innerText = isMicOn ? '🔊 Микрофон' : '🔇 Микрофон';
        document.getElementById('micBtn').classList.toggle('active', !isMicOn);
        if (groupCallActive) broadcastState();
    }
}

function toggleCam() {
    if (originalVideoTrack) {
        isCamOn = !isCamOn;
        originalVideoTrack.enabled = isCamOn;
        document.getElementById('camBtn').innerText = isCamOn ? '📹 Камера' : '📷 Камера';
        document.getElementById('camBtn').classList.toggle('active', !isCamOn);
        updateLocalVideoPlaceholder();
        if (groupCallActive) broadcastState();
    }
}

function updateLocalVideoPlaceholder() {
    const localWrapper = document.querySelector('#videosContainer > .videoWrapper:first-child');
    if (!localWrapper) return;
    const video = localWrapper.querySelector('video');
    const placeholder = localWrapper.querySelector('.noVideo');
    if (!isCamOn) {
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'noVideo';
            placeholder.innerHTML = `📷 ${currentUser}<br><small>Камера выкл.</small>`;
            localWrapper.insertBefore(placeholder, video || localWrapper.firstChild);
        }
        if (video) video.style.display = 'none';
    } else {
        if (placeholder) placeholder.remove();
        if (video) video.style.display = 'block';
    }
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        originalVideoTrack.enabled = false;
        localStream.addTrack(screenTrack);
        isCamOn = false;
        toggleCam();
        if (groupCallActive) broadcastState();
        screenTrack.onended = () => {
            localStream.removeTrack(screenTrack);
            originalVideoTrack.enabled = true;
            isCamOn = true;
            toggleCam();
        };
    } catch (e) {
        console.error('Ошибка демонстрации экрана:', e);
        alert('Не удалось поделиться экраном.');
    }
}

function endGroupCall() {
    Object.values(currentCalls).forEach(call => {
        if (call && call.close) call.close();
    });
    Object.values(dataConnections).forEach(conn => {
        if (conn && conn.close) conn.close();
    });
    currentCalls = {};
    dataConnections = {};
    groupCallActive = false;
    document.querySelectorAll('[data-peer]').forEach(el => el.remove());
    updateUsersList();
}

function initPeer() {
    peer = new Peer(currentUser, {
        host: 'peerjs.com',
        secure: true,
        port: 443
    });

    peer.on('open', (id) => {
        console.log('PeerJS подключен как', id);
        updateUsersList();
        startGroupCall(); // Авто-старт после open
    });

    peer.on('error', (err) => {
        console.error('PeerJS ошибка:', err);
        // Retry logic: переподключение через 5 сек
        setTimeout(() => {
            if (!peer.open) initPeer();
        }, 5000);
        alert('Ошибка PeerJS. Переподключение через 5 сек... (Попробуй Chrome, если Firefox глючит).');
    });

    peer.on('call', (call) => {
        if (!groupCallActive || !call) return;
        call.answer(localStream);
        currentCalls[call.peer] = call;
        call.on('stream', (stream) => {
            addRemoteVideo(call.peer, stream, call.peer);
        });
        call.on('close', () => {
            removeRemoteVideo(call.peer);
            delete currentCalls[call.peer];
        });
        call.on('error', (err) => {
            console.error('Ошибка звонка:', err);
            delete currentCalls[call.peer];
        });
        const conn = peer.connect(call.peer);
        if (conn) setupDataConnection(conn);
    });

    peer.on('connection', (conn) => {
        if (!groupCallActive || !conn) return;
        setupDataConnection(conn);
    });
}

function setupDataConnection(conn) {
    const peerId = conn.peer;
    dataConnections[peerId] = conn;
    conn.on('open', () => console.log('Data conn open to', peerId));
    conn.on('data', (data) => {
        if (data.type === 'message') {
            addMessage(data.text, false, data.from);
        }
    });
    conn.on('close', () => delete dataConnections[peerId]);
    conn.on('error', (err) => {
        console.error('Data conn error:', err);
        delete dataConnections[peerId];
    });
}

function startGroupCall() {
    if (groupCallActive || !peer || !peer.open) {
        console.log('Group call skipped: not ready');
        return;
    }
    groupCallActive = true;
    const otherUsers = getOtherUsers();
    otherUsers.forEach(user => {
        if (user !== currentUser && !currentCalls[user]) {
            const call = peer.call(user, localStream);
            if (!call) {
                console.error('Failed to call', user);
                return;
            }
            currentCalls[user] = call;
            call.on('stream', (stream) => addRemoteVideo(user, stream, user));
            call.on('close', () => {
                removeRemoteVideo(user);
                delete currentCalls[user];
            });
            call.on('error', (err) => {
                console.error('Call error to', user, ':', err);
                delete currentCalls[user];
            });
            const conn = peer.connect(user);
            if (conn) setupDataConnection(conn);
        }
    });
    updateUsersList();
}

function getOtherUsers() {
    const users = [];
    for (let key in localStorage) {
        if (key.startsWith('user_')) {
            const u = key.replace('user_', '');
            if (u !== currentUser) users.push(u);
        }
    }
    return users;
}

function updateUsersList() {
    const usersDiv = document.getElementById('usersList');
    usersDiv.innerHTML = '';
    const otherUsers = getOtherUsers();
    if (otherUsers.length === 0) {
        usersDiv.innerHTML = '<div style="text-align: center; color: #aaa; font-size: 12px;">Нет других пользователей. Пригласите друзей!</div>';
        return;
    }
    otherUsers.forEach(u => {
        const div = document.createElement('div');
        div.className = 'userItem';
        div.innerHTML = `
            <span>${u}</span>
            <span class="status">${currentCalls[u] ? 'Подключен' : 'Оффлайн'}</span>
        `;
        if (currentCalls[u]) div.classList.add('connected');
        usersDiv.appendChild(div);
    });
}

function broadcastState() {
    const state = { type: 'state', mic: isMicOn, cam: isCamOn };
    Object.values(dataConnections).forEach(conn => {
        if (conn && conn.open) conn.send(state);
    });
}

function addMessage(text, isOwn = true, from = '') {
    const chatArea = document.getElementById('chatArea');
    const msg = document.createElement('div');
    msg.className = `message ${isOwn ? 'own' : ''}`;
    msg.innerHTML = `<strong>${isOwn ? currentUser : from || 'Группа'}:</strong> ${text}`;
    chatArea.appendChild(msg);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (text) {
        addMessage(text, true);
        const msg = { type: 'message', text, from: currentUser };
        Object.values(dataConnections).forEach(conn => {
            if (conn && conn.open) conn.send(msg);
        });
        input.value = '';
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function showMessage(elementId, text, type = '') {
    const el = document.getElementById(elementId);
    el.innerText = text;
    if (type === 'error') el.style.color = '#ff6b6b';
}

// Init button states
document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('micBtn');
    const camBtn = document.getElementById('camBtn');
    if (micBtn) micBtn.innerText = '🔊 Микрофон';
    if (camBtn) camBtn.innerText = '📹 Камера';
});