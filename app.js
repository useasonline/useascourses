/**
 * useas - User Portal Application Script (app.js)
 * Displays all admin-saved courses immediately, fits YouTube player without zoom, and enables fullscreen.
 */

document.addEventListener('DOMContentLoaded', () => {
    const coursesGrid = document.getElementById('coursesGrid');
    const searchInput = document.getElementById('searchInput');
    const categoryContainer = document.getElementById('categoryContainer');
    
    // Player Modal Elements
    const playerModal = document.getElementById('playerModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalCourseTitle = document.getElementById('modalCourseTitle');
    const youtubeIframe = document.getElementById('youtubeIframe');
    const videoWrapper = document.getElementById('videoWrapper');
    const videoClickOverlay = document.getElementById('videoClickOverlay');
    const modalLessonTitle = document.getElementById('modalLessonTitle');
    const modalLessonDesc = document.getElementById('modalLessonDesc');
    const modalLessonCounter = document.getElementById('modalLessonCounter');
    const lessonsList = document.getElementById('lessonsList');
    const prevLessonBtn = document.getElementById('prevLessonBtn');
    const nextLessonBtn = document.getElementById('nextLessonBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');

    // App State
    let activeCategory = 'all';
    let searchQuery = '';
    let activeCourse = null;
    let activeLesson = null;
    let ytPlayer = null;
    let playerTimeInterval = null;
    let isScrubbing = false;
    let maxWatchedTime = 0;
    let pendingResumeTimestamp = 0;
    let noItemAnimData = null;
    let activeNoItemAnim = null;
    let lockedAnimData = null;
    let activeLockedAnim = null;

    fetch('animations/no-item-found.json')
        .then(res => res.json())
        .then(data => {
            noItemAnimData = data;
            if (document.getElementById('lottieNoItemWrap') && !activeNoItemAnim && window.lottie) {
                renderCourses();
            }
        })
        .catch(() => {});

    fetch('animations/locked.json')
        .then(res => res.json())
        .then(data => { lockedAnimData = data; })
        .catch(() => {});

    let latestYtCurrentTime = 0;
    let latestYtDuration = 0;
    let latestYtPlayerState = -1;
    let isCurrentlyPlaying = false;
    let isMuted = false;
    let currentVolume = 1;
    let playbackSpeed = 1;
    let isPipActive = false;
    let hasPlayerError = false;
    let currentVideoId = '';

    // Proctored Watch-Time, Camera Attention, Screen Share & Background Guard State
    let lessonCameraStream = null;
    let lessonScreenStream = null;
    let attentionMonitorInterval = null;
    let attentionCanvas = null;
    let attentionCtx = null;
    let prevFrameBytes = null;
    let awayStreakSeconds = 0;
    let faceDetectorInstance = null;
    let faceLandmarkerInstance = null;
    let faceLandmarkerLoading = false;
    let actualWatchedSeconds = 0;
    let lastWatchTickMs = 0;
    let skipViolationCount = 0;
    let lastSkipBlockedAlertMs = 0;
    let backgroundViolationCount = 0;
    let notListeningCount = 0;
    let isLessonVideoCompleted = false;
    let isRequestingMediaPermission = false;
    let proctorGateActive = false;
    let proctorGateMode = '';
    let maskHideTimeout = null;
    let topBarShieldTimeout = null;
    let notesSaveTimeout = null;

    // Window postMessage listener for embedded video iframe
    window.addEventListener('message', (event) => {
        try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data && data.event === 'infoDelivery' && data.info) {
                const info = data.info;
                if (typeof info.currentTime === 'number') {
                    latestYtCurrentTime = info.currentTime;
                }
                if (typeof info.duration === 'number' && info.duration > 0) {
                    latestYtDuration = info.duration;
                }
                if (typeof info.playerState === 'number') {
                    const prevState = latestYtPlayerState;
                    latestYtPlayerState = info.playerState;
                    if (info.playerState === 1) {
                        if (proctorGateActive) {
                            sendYTCommand('pauseVideo');
                            updatePausedMask(false, 'Video Paused');
                            return;
                        }
                        isCurrentlyPlaying = true;
                        lastWatchTickMs = Date.now();
                        updatePlayPauseUI(true);
                        updatePausedMask(true);
                        triggerTopBarShield(4200);
                        try {
                            if (ytPlayer && typeof ytPlayer.unloadModule === 'function') {
                                ytPlayer.unloadModule('captions');
                                ytPlayer.unloadModule('cc');
                            }
                        } catch (e) {}
                    } else if (info.playerState === 3) {
                        updatePausedMask(false, 'Loading Lesson Video...');
                        triggerTopBarShield(4500);
                    } else if (info.playerState === 2 || info.playerState === -1) {
                        isCurrentlyPlaying = false;
                        updatePlayPauseUI(false);
                        updatePausedMask(false, 'Video Paused');
                    } else if (info.playerState === 0 && prevState !== 0) {
                        isCurrentlyPlaying = false;
                        updatePlayPauseUI(false);
                        updatePausedMask(false, 'Lesson Completed');
                        handleVideoEndedVerification();
                    }
                }
            }
        } catch (e) {}
    });

    function getYTCurrentTime() {
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
            try {
                const t = ytPlayer.getCurrentTime();
                if (t > 0) return t;
            } catch (e) {}
        }
        return latestYtCurrentTime || 0;
    }

    function getYTDuration() {
        if (ytPlayer && typeof ytPlayer.getDuration === 'function') {
            try {
                const d = ytPlayer.getDuration();
                if (d > 0) return d;
            } catch (e) {}
        }
        return latestYtDuration || 0;
    }

    function getYTPlayerState() {
        if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
            try { return ytPlayer.getPlayerState(); } catch (e) {}
        }
        return latestYtPlayerState;
    }

    function sendYTCommand(func, args = []) {
        if (ytPlayer && typeof ytPlayer[func] === 'function') {
            try {
                ytPlayer[func](...args);
            } catch (e) {}
        }
        const iframe = document.getElementById('youtubeIframe');
        if (iframe && iframe.contentWindow) {
            try {
                iframe.contentWindow.postMessage(JSON.stringify({
                    event: 'command',
                    func: func,
                    args: args
                }), '*');
            } catch (e) {}
        }
    }

    function triggerTopBarShield(durationMs = 4200) {
        const shield = document.getElementById('ytTopBarShield');
        if (!shield) return;
        if (topBarShieldTimeout) {
            clearTimeout(topBarShieldTimeout);
            topBarShieldTimeout = null;
        }
        if (hasPlayerError) {
            shield.classList.remove('active');
            return;
        }
        shield.classList.add('active');
        topBarShieldTimeout = setTimeout(() => {
            shield.classList.remove('active');
            topBarShieldTimeout = null;
        }, durationMs);
    }

    function updateCornerLogoShield() {
        const cornerShield = document.getElementById('ytCornerLogoShield');
        if (!cornerShield) return;
        cornerShield.style.display = hasPlayerError ? 'none' : 'flex';
    }

    function updatePausedMask(isPlaying, captionText = '') {
        const mask = document.getElementById('videoPausedMask');
        const caption = document.getElementById('videoMaskCaption');
        updateCornerLogoShield();
        if (!mask) return;

        if (maskHideTimeout) {
            clearTimeout(maskHideTimeout);
            maskHideTimeout = null;
        }

        if (hasPlayerError) {
            mask.style.display = 'none';
            return;
        }

        if (isPlaying && !proctorGateActive) {
            if (caption) {
                caption.innerHTML = '<i class="fa-solid fa-circle-play"></i> <span>Starting Protected Video...</span>';
            }
            triggerTopBarShield(4400);
            // Wait ~3.4s so any embedded player title bar finishes fading before revealing frame
            maskHideTimeout = setTimeout(() => {
                if (isCurrentlyPlaying && !proctorGateActive && !hasPlayerError) {
                    mask.style.opacity = '0';
                    setTimeout(() => {
                        if (isCurrentlyPlaying && !proctorGateActive) {
                            mask.style.display = 'none';
                        }
                    }, 240);
                }
            }, 3400);
        } else {
            mask.style.display = 'flex';
            mask.style.opacity = '1';
            if (caption) {
                const label = captionText || 'Protected Course Video';
                caption.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span>${label}</span>`;
            }
        }
    }

    function updatePlayPauseUI(isPlaying) {
        const playIcon = document.getElementById('customPlayIcon');
        const bigCenterBtn = document.getElementById('bigCenterPlayBtn');
        const bigCenterIcon = document.getElementById('bigCenterPlayIcon');
        const clickOverlayIcon = document.getElementById('playPauseIcon');

        if (playIcon) playIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        if (bigCenterIcon) bigCenterIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        if (clickOverlayIcon) clickOverlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';

        if (bigCenterBtn) {
            if (hasPlayerError) {
                bigCenterBtn.style.display = 'none';
            } else {
                bigCenterBtn.style.display = isPlaying ? 'none' : 'flex';
            }
        }
    }

    function isLessonCameraLive() {
        if (!lessonCameraStream) return false;
        const tracks = lessonCameraStream.getVideoTracks();
        return tracks.length > 0 && tracks[0].readyState === 'live';
    }

    function showProctorGate(mode, title, desc, actionLabel) {
        proctorGateActive = true;
        proctorGateMode = mode;
        isCurrentlyPlaying = false;
        sendYTCommand('pauseVideo');
        updatePlayPauseUI(false);
        updatePausedMask(false, 'Video Paused');

        const overlay = document.getElementById('proctorGateOverlay');
        const iconWrap = document.getElementById('proctorGateIcon');
        const titleEl = document.getElementById('proctorGateTitle');
        const descEl = document.getElementById('proctorGateDesc');
        const actionBtn = document.getElementById('proctorGateActionBtn');

        if (titleEl) titleEl.textContent = title;
        if (descEl) descEl.textContent = desc;
        if (iconWrap) {
            iconWrap.className = mode === 'camera' ? 'proctor-gate-icon info' : 'proctor-gate-icon';
            iconWrap.innerHTML = mode === 'camera'
                ? '<i class="fa-solid fa-camera"></i>'
                : mode === 'background'
                ? '<i class="fa-solid fa-ban"></i>'
                : mode === 'incomplete'
                ? '<i class="fa-solid fa-lock"></i>'
                : '<i class="fa-solid fa-eye-slash"></i>';
        }
        if (actionBtn) {
            actionBtn.innerHTML = `<i class="fa-solid fa-play"></i> ${actionLabel || 'Resume Video'}`;
        }
        if (overlay) overlay.style.display = 'flex';
    }

    function hideProctorGate() {
        proctorGateActive = false;
        proctorGateMode = '';
        const overlay = document.getElementById('proctorGateOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    function updateCamBadgeUI(state, text, faceStatText = '') {
        const badge = document.getElementById('camAttentionBadge');
        const btn = document.getElementById('toggleProctorCamBtn');
        const faceStatEl = document.getElementById('analysisFaceStatus');
        if (badge) {
            badge.className = `cam-attention-badge ${state}`;
            badge.innerHTML = state === 'ok'
                ? `<i class="fa-solid fa-circle-check"></i> ${text}`
                : `<i class="fa-solid fa-triangle-exclamation"></i> ${text}`;
        }
        if (faceStatEl) {
            faceStatEl.textContent = faceStatText || text;
            faceStatEl.style.color = state === 'ok' ? '#059669' : '#dc2626';
        }
        if (btn) {
            btn.innerHTML = isLessonCameraLive()
                ? '<i class="fa-solid fa-video"></i> <span>Camera Active</span>'
                : '<i class="fa-solid fa-video"></i> <span>Enable Camera</span>';
            btn.classList.toggle('active-share', isLessonCameraLive());
        }
    }

    async function requestLessonCamera(andPlay = false) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('⚠️ Camera API is not supported in this browser.', 'warning');
            return false;
        }
        if (isLessonCameraLive()) {
            if (andPlay) {
                hideProctorGate();
                awayStreakSeconds = 0;
                lastWatchTickMs = Date.now();
                isCurrentlyPlaying = true;
                sendYTCommand('playVideo');
                updatePlayPauseUI(true);
            }
            return true;
        }

        isRequestingMediaPermission = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
                audio: false
            });
            lessonCameraStream = stream;
            const camEl = document.getElementById('lessonProctorCam');
            if (camEl) {
                camEl.srcObject = stream;
                try { await camEl.play(); } catch (e) {}
            }
            const track = stream.getVideoTracks()[0];
            if (track) {
                track.onended = () => {
                    updateCamBadgeUI('warn', 'Cam Stopped');
                    if (playerModal && playerModal.classList.contains('active') && activeLesson && (activeLesson.type || 'video') === 'video') {
                        showProctorGate(
                            'camera',
                            'Camera Disconnected',
                            'Camera access was turned off. Re-enable camera access to continue watching.',
                            'Enable Camera & Resume'
                        );
                    }
                };
            }
            updateCamBadgeUI('ok', 'Listening ✓');
            startAttentionMonitor();
            if (andPlay) {
                hideProctorGate();
                awayStreakSeconds = 0;
                lastWatchTickMs = Date.now();
                isCurrentlyPlaying = true;
                sendYTCommand('playVideo');
                updatePlayPauseUI(true);
            }
            return true;
        } catch (err) {
            updateCamBadgeUI('warn', 'Cam Denied');
            showProctorGate(
                'camera',
                'Camera Access Required',
                'Please allow camera permission in your browser to watch this course video.',
                'Allow Camera & Play'
            );
            showToast('📷 Camera access is required to play course videos.', 'warning');
            return false;
        } finally {
            setTimeout(() => { isRequestingMediaPermission = false; }, 400);
        }
    }

    async function requestLessonScreenShare() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('⚠️ Screen sharing is not supported in this browser.', 'warning');
            return;
        }
        const labelEl = document.getElementById('shareScreenLabel');
        const btnEl = document.getElementById('shareScreenBtn');

        if (lessonScreenStream) {
            lessonScreenStream.getTracks().forEach(t => t.stop());
            lessonScreenStream = null;
            if (labelEl) labelEl.textContent = 'Share Screen';
            if (btnEl) btnEl.classList.remove('active-share');
            showToast('🖥️ Screen share stopped.', 'info');
            return;
        }

        isRequestingMediaPermission = true;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'monitor' },
                audio: false
            });
            lessonScreenStream = stream;
            const track = stream.getVideoTracks()[0];
            const settings = track && track.getSettings ? track.getSettings() : {};
            if (labelEl) labelEl.textContent = 'Screen Shared ✓';
            if (btnEl) btnEl.classList.add('active-share');

            if (settings.displaySurface && settings.displaySurface !== 'monitor') {
                showToast('🖥️ Screen share active (tip: share Entire Screen for full proctoring).', 'info');
            } else {
                showToast('🖥️ Screen sharing active!', 'success');
            }

            if (track) {
                track.onended = () => {
                    lessonScreenStream = null;
                    if (labelEl) labelEl.textContent = 'Share Screen';
                    if (btnEl) btnEl.classList.remove('active-share');
                    if (playerModal && playerModal.classList.contains('active') && isCurrentlyPlaying) {
                        sendYTCommand('pauseVideo');
                        isCurrentlyPlaying = false;
                        updatePlayPauseUI(false);
                        showToast('⚠️ Screen share ended. Video paused.', 'warning');
                    }
                };
            }
        } catch (err) {
            showToast('🖥️ Screen share cancelled or blocked by browser.', 'info');
        } finally {
            setTimeout(() => { isRequestingMediaPermission = false; }, 500);
        }
    }

    function playAttentionAlertTone() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const now = ctx.currentTime;
            [680, 520].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.16);
                gain.gain.setValueAtTime(0.08, now + idx * 0.16);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.14);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.16);
                osc.stop(now + idx * 0.16 + 0.15);
            });
            setTimeout(() => { try { ctx.close(); } catch (e) {} }, 600);
        } catch (e) {}
    }

    function updateLiveAlertBanner(show, message = '') {
        const banner = document.getElementById('proctorLiveAlertBanner');
        const textEl = document.getElementById('proctorLiveAlertText');
        if (!banner) return;
        if (show && !proctorGateActive) {
            if (textEl && message) textEl.textContent = message;
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    }

    function drawProctorFaceBox(boxNorm, statusKind = 'ok') {
        const overlayCanvas = document.getElementById('proctorFaceOverlay');
        if (!overlayCanvas) return;
        const ctx = overlayCanvas.getContext('2d');
        if (!ctx) return;
        const W = overlayCanvas.width;
        const H = overlayCanvas.height;
        ctx.clearRect(0, 0, W, H);

        if (!boxNorm) return;

        const color = statusKind === 'ok' ? '#10b981' : statusKind === 'warn' ? '#f59e0b' : '#ef4444';
        const x = Math.max(4, Math.min(W - 12, boxNorm.x * W));
        const y = Math.max(4, Math.min(H - 12, boxNorm.y * H));
        const w = Math.max(18, Math.min(W - x - 4, boxNorm.w * W));
        const h = Math.max(18, Math.min(H - y - 4, boxNorm.h * H));
        const cLen = Math.min(10, w * 0.25, h * 0.25);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Top-left
        ctx.moveTo(x, y + cLen); ctx.lineTo(x, y); ctx.lineTo(x + cLen, y);
        // Top-right
        ctx.moveTo(x + w - cLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cLen);
        // Bottom-left
        ctx.moveTo(x, y + h - cLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cLen, y + h);
        // Bottom-right
        ctx.moveTo(x + w - cLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cLen);
        ctx.stroke();

        // Subtle center reticle point
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h * 0.42, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }

    async function initMediaPipeFaceLandmarker() {
        if (faceLandmarkerInstance || faceLandmarkerLoading) return;
        faceLandmarkerLoading = true;
        try {
            const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
            if (!vision || !vision.FilesetResolver || !vision.FaceLandmarker) return;
            const filesetResolver = await vision.FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
            );
            faceLandmarkerInstance = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU'
                },
                outputFaceBlendshapes: true,
                runningMode: 'VIDEO',
                numFaces: 1
            });
        } catch (e) {
            // Fallback seamlessly to built-in geometric computer-vision gaze analyzer
        } finally {
            faceLandmarkerLoading = false;
        }
    }

    function stopAttentionMonitor() {
        if (attentionMonitorInterval) {
            clearInterval(attentionMonitorInterval);
            attentionMonitorInterval = null;
        }
        prevFrameBytes = null;
        awayStreakSeconds = 0;
        updateLiveAlertBanner(false);
        drawProctorFaceBox(null);
    }

    function stopLessonProctoringStreams() {
        stopAttentionMonitor();
        if (lessonCameraStream) {
            lessonCameraStream.getTracks().forEach(t => t.stop());
            lessonCameraStream = null;
        }
        if (lessonScreenStream) {
            lessonScreenStream.getTracks().forEach(t => t.stop());
            lessonScreenStream = null;
        }
        const camEl = document.getElementById('lessonProctorCam');
        if (camEl) camEl.srcObject = null;
        const labelEl = document.getElementById('shareScreenLabel');
        const btnEl = document.getElementById('shareScreenBtn');
        if (labelEl) labelEl.textContent = 'Share Screen';
        if (btnEl) btnEl.classList.remove('active-share');
        updateCamBadgeUI('warn', 'Cam Off', 'Cam Off');
        hideProctorGate();
    }

    function handleNotListeningViolation(reasonText) {
        notListeningCount += 1;
        awayStreakSeconds = 0;
        updateLiveAlertBanner(false);
        playAttentionAlertTone();

        const curr = getYTCurrentTime();
        const repeatTarget = Math.max(0, curr - 10);
        maxWatchedTime = Math.min(maxWatchedTime, repeatTarget);
        actualWatchedSeconds = Math.max(0, actualWatchedSeconds - 10);
        latestYtCurrentTime = repeatTarget;
        sendYTCommand('seekTo', [repeatTarget, true]);
        triggerTopBarShield(4200);
        updateVideoAnalysisUI(repeatTarget, getYTDuration());

        updateCamBadgeUI('warn', 'Looking Away!', 'Paused (Away)');
        showProctorGate(
            'not_listening',
            'Attention Alert: Face Not Looking at Screen',
            `${reasonText} Video has been paused and rewound 10 seconds. Face the camera and look at the screen to continue.`,
            'I Am Looking — Resume'
        );
        showToast('👀 Alert: You were not looking at the screen! Video paused.', 'warning');
    }

    function handleBackgroundSwitchViolation(reasonText) {
        if (!playerModal || !playerModal.classList.contains('active')) return;
        if (!activeLesson || (activeLesson.type || 'video') !== 'video' || hasPlayerError) return;
        if (proctorGateActive && proctorGateMode === 'background') return;

        backgroundViolationCount += 1;
        updateLiveAlertBanner(false);
        playAttentionAlertTone();

        const curr = getYTCurrentTime();
        const repeatTarget = Math.max(0, curr - 10);
        maxWatchedTime = Math.min(maxWatchedTime, repeatTarget);
        latestYtCurrentTime = repeatTarget;
        sendYTCommand('seekTo', [repeatTarget, true]);
        triggerTopBarShield(4200);
        updateVideoAnalysisUI(repeatTarget, getYTDuration());

        showProctorGate(
            'background',
            'Background App / Website Blocked',
            `${reasonText} Opening other websites or switching apps is blocked. Rewound 10s — stay on this window to continue.`,
            'Return & Resume Video'
        );
        showToast('🚫 Another website / app switch blocked! Video paused.', 'danger');
    }

    function startAttentionMonitor() {
        stopAttentionMonitor();
        if (!attentionCanvas) {
            attentionCanvas = document.createElement('canvas');
            attentionCanvas.width = 96;
            attentionCanvas.height = 72;
            attentionCtx = attentionCanvas.getContext('2d', { willReadFrequently: true });
        }
        if ('FaceDetector' in window && !faceDetectorInstance) {
            try { faceDetectorInstance = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch (e) {}
        }
        initMediaPipeFaceLandmarker();

        attentionMonitorInterval = setInterval(async () => {
            if (!playerModal || !playerModal.classList.contains('active')) return;
            if (!activeLesson || (activeLesson.type || 'video') !== 'video') return;
            if (hasPlayerError) return;

            if (!isLessonCameraLive()) {
                drawProctorFaceBox(null);
                updateLiveAlertBanner(false);
                updateCamBadgeUI('warn', 'Cam Off', 'Cam Off');
                if (!proctorGateActive) {
                    showProctorGate(
                        'camera',
                        'Camera Required to Watch',
                        'Enable your camera to verify you are facing and looking at the lesson.',
                        'Enable Camera & Play'
                    );
                }
                return;
            }

            const camEl = document.getElementById('lessonProctorCam');
            if (!camEl || camEl.readyState < 2 || !attentionCtx) return;

            const state = getYTPlayerState();
            const isVideoActive = (state === 1 || isCurrentlyPlaying) && !proctorGateActive;
            const isNotLookingGate = proctorGateActive && proctorGateMode === 'not_listening';
            if (!isVideoActive && !isNotLookingGate) return;

            try {
                const W = 96;
                const H = 72;
                attentionCtx.drawImage(camEl, 0, 0, W, H);
                const frame = attentionCtx.getImageData(0, 0, W, H).data;
                const pixelCount = W * H;
                let sum = 0;
                let sumSq = 0;
                let diffSum = 0;
                let skinCount = 0;
                let skinSumX = 0;
                let skinSumY = 0;
                let minSX = W, maxSX = 0, minSY = H, maxSY = 0;
                const gray = new Uint8Array(pixelCount);

                for (let y = 0, p = 0; y < H; y++) {
                    for (let x = 0; x < W; x++, p++) {
                        const i = p * 4;
                        const r = frame[i];
                        const g = frame[i + 1];
                        const b = frame[i + 2];
                        const lum = r * 0.299 + g * 0.587 + b * 0.114;
                        gray[p] = lum;
                        sum += lum;
                        sumSq += lum * lum;
                        if (prevFrameBytes) {
                            diffSum += Math.abs(lum - prevFrameBytes[p]);
                        }

                        if (x >= 12 && x <= W - 12 && y >= 4 && y <= H - 4) {
                            const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
                            const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
                            if (lum > 35 && cb >= 72 && cb <= 132 && cr >= 130 && cr <= 178) {
                                skinCount++;
                                skinSumX += x;
                                skinSumY += y;
                                if (x < minSX) minSX = x;
                                if (x > maxSX) maxSX = x;
                                if (y < minSY) minSY = y;
                                if (y > maxSY) maxSY = y;
                            }
                        }
                    }
                }

                const mean = sum / pixelCount;
                const variance = (sumSq / pixelCount) - (mean * mean);
                const avgDiff = prevFrameBytes ? (diffSum / pixelCount) : 5;
                prevFrameBytes = gray;

                const lensBlocked = mean < 12 || variance < 7;

                let statusKind = 'ok';
                let badgeText = 'Looking ✓';
                let statText = 'Looking ✓';
                let awayReason = '';
                let trackedBox = null;

                if (lensBlocked) {
                    statusKind = 'danger';
                    badgeText = 'Cam Covered';
                    statText = 'Cam Covered';
                    awayReason = 'Your camera appears covered or too dark.';
                } else if (faceLandmarkerInstance) {
                    try {
                        const result = faceLandmarkerInstance.detectForVideo(camEl, performance.now());
                        const landmarks = result && result.faceLandmarks && result.faceLandmarks[0];
                        if (!landmarks || landmarks.length < 400) {
                            statusKind = 'danger';
                            badgeText = 'No Face Seen';
                            statText = 'No Face';
                            awayReason = 'No face was detected in front of the camera.';
                        } else {
                            let minX = 1, maxX = 0, minY = 1, maxY = 0;
                            for (let k = 0; k < landmarks.length; k++) {
                                const pt = landmarks[k];
                                if (pt.x < minX) minX = pt.x;
                                if (pt.x > maxX) maxX = pt.x;
                                if (pt.y < minY) minY = pt.y;
                                if (pt.y > maxY) maxY = pt.y;
                            }
                            trackedBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

                            const nose = landmarks[1];
                            const leftCheek = landmarks[234];
                            const rightCheek = landmarks[454];
                            const forehead = landmarks[10];
                            const chin = landmarks[152];
                            const leftEyeOuter = landmarks[33];
                            const rightEyeOuter = landmarks[263];

                            const faceWidth = Math.max(0.06, Math.abs(rightCheek.x - leftCheek.x));
                            const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
                            const yawOffset = Math.abs(nose.x - faceCenterX) / faceWidth;

                            const faceHeight = Math.max(0.08, Math.abs(chin.y - forehead.y));
                            const eyeMidY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
                            const pitchRatio = (nose.y - eyeMidY) / faceHeight;

                            let blinkClosed = false;
                            const blend = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
                            if (blend) {
                                const bL = blend.find(c => c.categoryName === 'eyeBlinkLeft')?.score || 0;
                                const bR = blend.find(c => c.categoryName === 'eyeBlinkRight')?.score || 0;
                                if (bL > 0.72 && bR > 0.72) blinkClosed = true;
                            }

                            const offFrame = faceCenterX < 0.16 || faceCenterX > 0.84 || eyeMidY < 0.10 || eyeMidY > 0.85;
                            if (offFrame || yawOffset > 0.23) {
                                statusKind = 'warn';
                                badgeText = 'Looking Away';
                                statText = 'Turned Away';
                                awayReason = 'Your face turned away from the lesson screen.';
                            } else if (pitchRatio > 0.43 || pitchRatio < 0.06) {
                                statusKind = 'warn';
                                badgeText = 'Look At Screen';
                                statText = 'Looking Down/Up';
                                awayReason = 'You appear to be looking down or away from the screen.';
                            } else if (blinkClosed) {
                                statusKind = 'warn';
                                badgeText = 'Eyes Closed';
                                statText = 'Eyes Closed';
                                awayReason = 'Your eyes appear closed instead of watching the lesson.';
                            } else {
                                statusKind = 'ok';
                                badgeText = 'Looking ✓';
                                statText = 'Looking ✓';
                            }
                        }
                    } catch (e) {
                        faceLandmarkerInstance = null;
                    }
                }

                // Built-in instant computer-vision face & gaze orientation fallback
                if (!faceLandmarkerInstance && !lensBlocked) {
                    let nativeBox = null;
                    if (faceDetectorInstance) {
                        try {
                            const faces = await faceDetectorInstance.detect(camEl);
                            if (faces && faces.length > 0 && faces[0].boundingBox) {
                                const b = faces[0].boundingBox;
                                const vw = camEl.videoWidth || 320;
                                const vh = camEl.videoHeight || 240;
                                nativeBox = { x: b.x / vw, y: b.y / vh, w: b.width / vw, h: b.height / vh };
                            }
                        } catch (e) {}
                    }

                    const hasSkinCluster = skinCount >= 95 && maxSX > minSX && maxSY > minSY;
                    if (nativeBox) {
                        trackedBox = nativeBox;
                        const cxNorm = nativeBox.x + nativeBox.w / 2;
                        const cyNorm = nativeBox.y + nativeBox.h / 2;
                        if (cxNorm < 0.20 || cxNorm > 0.80 || cyNorm < 0.15 || cyNorm > 0.85) {
                            statusKind = 'warn';
                            badgeText = 'Looking Away';
                            statText = 'Off Center';
                            awayReason = 'Keep your face centered and facing the screen.';
                        }
                    } else if (!hasSkinCluster) {
                        statusKind = 'danger';
                        badgeText = 'No Face Seen';
                        statText = 'No Face';
                        awayReason = 'No face detected in front of the camera.';
                    } else {
                        const cx = skinSumX / skinCount;
                        const cy = skinSumY / skinCount;
                        const cxNorm = cx / W;
                        const cyNorm = cy / H;
                        trackedBox = {
                            x: minSX / W,
                            y: minSY / H,
                            w: (maxSX - minSX) / W,
                            h: (maxSY - minSY) / H
                        };

                        // Check bilateral symmetry around centroid to detect head turned left/right
                        let leftCount = 0;
                        let rightCount = 0;
                        for (let y = minSY; y <= maxSY; y++) {
                            for (let x = minSX; x <= maxSX; x++) {
                                const idx = (y * W + x) * 4;
                                const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
                                const lum = r * 0.299 + g * 0.587 + b * 0.114;
                                const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
                                const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
                                if (lum > 35 && cb >= 72 && cb <= 132 && cr >= 130 && cr <= 178) {
                                    if (x < cx) leftCount++;
                                    else rightCount++;
                                }
                            }
                        }
                        const symRatio = Math.min(leftCount, rightCount) / Math.max(1, Math.max(leftCount, rightCount));
                        const offCenter = cxNorm < 0.22 || cxNorm > 0.78 || cyNorm < 0.16 || cyNorm > 0.82;

                        if (offCenter || symRatio < 0.42) {
                            statusKind = 'warn';
                            badgeText = 'Looking Away';
                            statText = 'Turned Away';
                            awayReason = 'Your face turned away from the lesson screen.';
                        } else if (avgDiff < 0.25 && variance < 120) {
                            statusKind = 'warn';
                            badgeText = 'Check Focus';
                            statText = 'Static Frame';
                            awayReason = 'Live viewer movement not detected.';
                        }
                    }
                }

                drawProctorFaceBox(trackedBox, statusKind);

                if (statusKind === 'ok') {
                    awayStreakSeconds = 0;
                    updateLiveAlertBanner(false);
                    updateCamBadgeUI('ok', badgeText, statText);
                } else {
                    updateCamBadgeUI('warn', badgeText, statText);
                    if (isVideoActive) {
                        awayStreakSeconds += (lensBlocked ? 1.0 : 0.5);
                        const secsLeft = Math.max(1, Math.ceil(3.0 - awayStreakSeconds));
                        if (awayStreakSeconds >= 1.0 && awayStreakSeconds < 3.0) {
                            updateLiveAlertBanner(true, `Alert: ${badgeText} — Pausing video in ${secsLeft}s`);
                        }
                        if (awayStreakSeconds >= 3.0) {
                            handleNotListeningViolation(awayReason || 'Not facing or looking at the screen.');
                        }
                    }
                }
            } catch (e) {}
        }, 500);
    }

    function togglePlayPause() {
        if (proctorGateActive) {
            const actionBtn = document.getElementById('proctorGateActionBtn');
            if (actionBtn) actionBtn.click();
            return;
        }
        if (activeLesson && (activeLesson.type || 'video') === 'video' && !isLessonCameraLive()) {
            showProctorGate(
                'camera',
                'Camera Access Required',
                'Allow camera access so we can verify you are watching and listening before playing.',
                'Enable Camera & Play'
            );
            return;
        }
        const state = getYTPlayerState();
        const playing = (state === 1) || isCurrentlyPlaying;
        if (playing) {
            isCurrentlyPlaying = false;
            sendYTCommand('pauseVideo');
            showPlayPauseAnim('pause');
            updatePlayPauseUI(false);
            updatePausedMask(false, 'Video Paused');
        } else {
            isCurrentlyPlaying = true;
            lastWatchTickMs = Date.now();
            sendYTCommand('playVideo');
            showPlayPauseAnim('play');
            updatePlayPauseUI(true);
            updatePausedMask(true);
        }
    }

    function rewind10Seconds() {
        const curr = getYTCurrentTime();
        const newTime = Math.max(0, curr - 10);
        latestYtCurrentTime = newTime;
        triggerTopBarShield(4200);
        sendYTCommand('seekTo', [newTime, true]);
        showToast('⏪ Rewound 10 seconds', 'info');
    }

    function toggleMute() {
        isMuted = !isMuted;
        const muteIcon = document.getElementById('customMuteIcon');
        const volSlider = document.getElementById('customVolumeSlider');

        if (isMuted) {
            sendYTCommand('mute');
            if (muteIcon) muteIcon.className = 'fa-solid fa-volume-xmark';
            if (volSlider) volSlider.value = 0;
        } else {
            sendYTCommand('unMute');
            sendYTCommand('setVolume', [(currentVolume || 1) * 100]);
            if (muteIcon) muteIcon.className = 'fa-solid fa-volume-high';
            if (volSlider) volSlider.value = currentVolume || 1;
        }
    }

    function handleVolumeChange(val) {
        currentVolume = val;
        isMuted = val === 0;
        const muteIcon = document.getElementById('customMuteIcon');
        sendYTCommand('setVolume', [val * 100]);
        if (val === 0) {
            sendYTCommand('mute');
            if (muteIcon) muteIcon.className = 'fa-solid fa-volume-xmark';
        } else {
            sendYTCommand('unMute');
            if (muteIcon) muteIcon.className = 'fa-solid fa-volume-high';
        }
    }

    function toggleSpeedMenu() {
        const dropdown = document.getElementById('speedMenuDropdown');
        if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }
    }

    function setPlaybackSpeed(speed) {
        playbackSpeed = speed;
        sendYTCommand('setPlaybackRate', [speed]);
        const speedBtn = document.getElementById('speedMenuBtn');
        const dropdown = document.getElementById('speedMenuDropdown');

        if (speedBtn) speedBtn.textContent = `${speed}x`;
        if (dropdown) {
            dropdown.style.display = 'none';
            dropdown.querySelectorAll('.speed-option').forEach(opt => {
                const spd = parseFloat(opt.getAttribute('data-speed'));
                opt.classList.toggle('active', spd === speed);
            });
        }
        showToast(`⚡ Playback speed set to ${speed}x`, 'info');
    }

    function togglePip() {
        const videoContainer = document.getElementById('videoContainer');
        const pipTitleBar = document.getElementById('pipTitleBar');
        const pipPlaceholder = document.getElementById('pipPlaceholderCard');
        if (!videoContainer) return;

        isPipActive = !isPipActive;
        if (isPipActive) {
            videoContainer.classList.add('pip-active');
            if (pipTitleBar) pipTitleBar.style.display = 'flex';
            if (pipPlaceholder) pipPlaceholder.style.display = 'flex';
            showToast('📺 Floating Picture-in-Picture mode active', 'info');
        } else {
            videoContainer.classList.remove('pip-active');
            if (pipTitleBar) pipTitleBar.style.display = 'none';
            if (pipPlaceholder) pipPlaceholder.style.display = 'none';
        }
    }

    function updateFullscreenBtnUI(isFs) {
        const icon = document.getElementById('fullscreenIcon');
        const label = document.getElementById('fullscreenLabel');
        const btn = document.getElementById('fullscreenBtn');
        if (icon) icon.className = isFs ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        if (label) label.textContent = isFs ? 'Exit' : 'Fullscreen';
        if (btn) btn.title = isFs ? 'Exit Fullscreen (Esc)' : 'Toggle Fullscreen (F)';
    }

    function toggleFullscreen() {
        const container = document.getElementById('videoContainer') || document.getElementById('videoWrapper');
        if (!container) return;

        // Exit PiP first if active so fullscreen fills viewport cleanly
        if (isPipActive) {
            togglePip();
        }

        const fsElem = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        const isCssFs = container.classList.contains('is-fullscreen');

        if (!fsElem && !isCssFs) {
            const reqFs = container.requestFullscreen || container.webkitRequestFullscreen || container.msRequestFullscreen;
            if (reqFs) {
                try {
                    const result = reqFs.call(container);
                    if (result && typeof result.then === 'function') {
                        result.then(() => {
                            updateFullscreenBtnUI(true);
                        }).catch(() => {
                            container.classList.add('is-fullscreen');
                            updateFullscreenBtnUI(true);
                        });
                    } else {
                        updateFullscreenBtnUI(true);
                    }
                } catch (e) {
                    container.classList.add('is-fullscreen');
                    updateFullscreenBtnUI(true);
                }
            } else {
                container.classList.add('is-fullscreen');
                updateFullscreenBtnUI(true);
            }
        } else {
            if (isCssFs) {
                container.classList.remove('is-fullscreen');
                updateFullscreenBtnUI(false);
            }
            if (fsElem) {
                const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (exitFs) {
                    try {
                        const result = exitFs.call(document);
                        if (result && typeof result.then === 'function') {
                            result.then(() => updateFullscreenBtnUI(false)).catch(() => updateFullscreenBtnUI(false));
                        } else {
                            updateFullscreenBtnUI(false);
                        }
                    } catch (e) {
                        updateFullscreenBtnUI(false);
                    }
                }
            }
        }
    }

    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(evt => {
        document.addEventListener(evt, () => {
            const container = document.getElementById('videoContainer');
            const fsElem = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            const isCssFs = container ? container.classList.contains('is-fullscreen') : false;
            updateFullscreenBtnUI(Boolean(fsElem || isCssFs));
        });
    });

    function handleMouseMoveControls() {
        const controlsBar = document.getElementById('customVideoControlsBar');
        if (!controlsBar) return;
        controlsBar.classList.remove('controls-hidden');
    }

    function startCustomTimeTracker() {
        stopCustomTimeTracker();
        playerTimeInterval = setInterval(() => {
            const curr = getYTCurrentTime();
            const dur = getYTDuration();
            updateCustomBarUI(curr, dur);
        }, 300);
    }

    function stopCustomTimeTracker() {
        if (playerTimeInterval) {
            clearInterval(playerTimeInterval);
            playerTimeInterval = null;
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        const formattedSecs = secs < 10 ? `0${secs}` : `${secs}`;
        if (hrs > 0) {
            const formattedMins = mins < 10 ? `0${mins}` : `${mins}`;
            return `${hrs}:${formattedMins}:${formattedSecs}`;
        }
        return `${mins}:${formattedSecs}`;
    }

    function formatTimeWithSeconds(seconds) {
        const totalSecs = Math.floor(Math.max(0, isNaN(seconds) ? 0 : seconds));
        return `${formatTime(totalSecs)} (${totalSecs}s)`;
    }

    function updateVideoAnalysisUI(curr, dur) {
        const totalEl = document.getElementById('analysisTotalTime');
        const watchedEl = document.getElementById('analysisWatchedTime');
        const remainingEl = document.getElementById('analysisRemainingTime');
        const awayEl = document.getElementById('analysisAwayCount');
        const skipEl = document.getElementById('analysisSkipCount');
        const bgEl = document.getElementById('analysisBgCount');

        const safeDur = dur > 0 ? dur : 0;
        const effectiveWatched = (isLessonVideoCompleted && safeDur > 0 && actualWatchedSeconds < safeDur * 0.9)
            ? safeDur
            : actualWatchedSeconds;
        const cappedWatched = safeDur > 0 ? Math.min(safeDur, effectiveWatched) : effectiveWatched;
        const pct = safeDur > 0 ? Math.min(100, Math.round((cappedWatched / safeDur) * 100)) : 0;
        const remainingTotal = safeDur > 0 ? Math.max(0, safeDur - cappedWatched) : 0;

        if (totalEl) totalEl.textContent = formatTimeWithSeconds(safeDur);
        if (watchedEl) watchedEl.textContent = `${formatTime(cappedWatched)} · ${Math.floor(cappedWatched)}s (${pct}%)`;
        if (remainingEl) {
            remainingEl.textContent = isLessonVideoCompleted ? '0:00 (0s ✓)' : formatTimeWithSeconds(remainingTotal);
            remainingEl.style.color = isLessonVideoCompleted ? '#059669' : '';
        }
        if (awayEl) {
            awayEl.textContent = `${notListeningCount}`;
            awayEl.style.color = notListeningCount > 0 ? '#dc2626' : '#059669';
        }
        if (skipEl) {
            skipEl.textContent = `${skipViolationCount}`;
            skipEl.style.color = skipViolationCount > 0 ? '#dc2626' : '#059669';
        }
        if (bgEl) {
            bgEl.textContent = `${backgroundViolationCount}`;
            bgEl.style.color = backgroundViolationCount > 0 ? '#dc2626' : '#059669';
        }
    }

    function blockSkipAttempt(dur, customMsg = '') {
        const safeDur = dur > 0 ? dur : getYTDuration();
        const allowedMax = (isLessonVideoCompleted && safeDur > 0) ? safeDur : Math.max(0, maxWatchedTime);
        const now = Date.now();

        if (now - lastSkipBlockedAlertMs > 850) {
            skipViolationCount += 1;
            lastSkipBlockedAlertMs = now;
            showToast(customMsg || '🚫 Video skipping is blocked! Watch the full video without skipping forward.', 'warning');
        }

        latestYtCurrentTime = allowedMax;
        triggerTopBarShield(4200);
        sendYTCommand('seekTo', [allowedMax, true]);

        const scrubSlider = document.getElementById('customScrubSlider');
        const scrubFill = document.getElementById('customScrubFill');
        const scrubWatched = document.getElementById('customScrubWatched');
        const timeDisplay = document.getElementById('customTimeDisplay');
        const remainingDisplay = document.getElementById('customRemainingDisplay');

        if (safeDur > 0) {
            const safePct = Math.min(100, (allowedMax / safeDur) * 100);
            const remSecs = Math.max(0, safeDur - allowedMax);
            if (scrubSlider) scrubSlider.value = safePct;
            if (scrubFill) scrubFill.style.width = `${safePct}%`;
            if (scrubWatched) scrubWatched.style.width = `${safePct}%`;
            if (timeDisplay) timeDisplay.textContent = `${formatTime(allowedMax)} / ${formatTime(safeDur)}`;
            if (remainingDisplay) remainingDisplay.textContent = `${formatTime(remSecs)} (${Math.floor(remSecs)}s left)`;
        }
        updateVideoAnalysisUI(allowedMax, safeDur);
    }

    function updateCustomBarUI(curr, dur) {
        const state = getYTPlayerState();
        const now = Date.now();

        if (state === 1 && !proctorGateActive && !hasPlayerError) {
            // Enforce normal 1x playback speed so speed-skipping cannot bypass watch duration
            try {
                if (ytPlayer && typeof ytPlayer.getPlaybackRate === 'function' && ytPlayer.getPlaybackRate() !== 1) {
                    sendYTCommand('setPlaybackRate', [1]);
                }
            } catch (e) {}

            if (!isLessonVideoCompleted && dur > 0 && curr > maxWatchedTime + 1.5) {
                blockSkipAttempt(dur);
                return;
            }

            const dt = lastWatchTickMs > 0 ? Math.min(1.2, Math.max(0, (now - lastWatchTickMs) / 1000)) : 0.3;
            if (lastWatchTickMs > 0) {
                actualWatchedSeconds += dt;
            }
            lastWatchTickMs = now;

            if (!isLessonVideoCompleted && curr > maxWatchedTime) {
                maxWatchedTime = Math.min(curr, maxWatchedTime + Math.max(0.45, dt * 1.4));
            }
            if (curr > 1 && activeCourse && activeLesson && window.UseasStore) {
                window.UseasStore.saveLessonTimestamp(activeCourse.id, activeLesson.id, Math.min(curr, maxWatchedTime));
            }
        } else {
            lastWatchTickMs = now;
        }

        if (pendingResumeTimestamp > 2 && dur > 0) {
            const resumeTime = pendingResumeTimestamp;
            pendingResumeTimestamp = 0;
            maxWatchedTime = Math.max(maxWatchedTime, resumeTime);
            latestYtCurrentTime = resumeTime;
            triggerTopBarShield(4200);
            sendYTCommand('seekTo', [resumeTime, true]);
            const pct = Math.round((resumeTime / dur) * 100);
            showToast(`▶ Resumed playback from ${formatTime(resumeTime)} (${pct}%)`, 'info');
        }

        const timeDisplay = document.getElementById('customTimeDisplay');
        const remainingDisplay = document.getElementById('customRemainingDisplay');
        const scrubSlider = document.getElementById('customScrubSlider');
        const scrubFill = document.getElementById('customScrubFill');
        const scrubWatched = document.getElementById('customScrubWatched');
        const skipLockedBadge = document.getElementById('skipLockedBadge');
        const playIcon = document.getElementById('customPlayIcon');

        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(curr)} / ${formatTime(dur)}`;
        }
        if (remainingDisplay) {
            const remSecs = dur > 0 ? Math.max(0, dur - curr) : 0;
            remainingDisplay.textContent = dur > 0
                ? `${formatTime(remSecs)} (${Math.floor(remSecs)}s left)`
                : '0:00 (0s left)';
        }

        if (dur > 0 && scrubSlider && scrubFill && !isScrubbing) {
            const pct = Math.min(100, (curr / dur) * 100);
            scrubSlider.value = pct;
            scrubFill.style.width = `${pct}%`;
            if (scrubWatched) {
                const watchedPct = isLessonVideoCompleted ? 100 : Math.min(100, (maxWatchedTime / dur) * 100);
                scrubWatched.style.width = `${watchedPct}%`;
            }
        }

        if (skipLockedBadge) {
            skipLockedBadge.style.display = isLessonVideoCompleted ? 'none' : 'inline-flex';
        }

        if (playIcon) {
            playIcon.className = state === 1 ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }

        updateVideoAnalysisUI(curr, dur);

        if (dur > 0 && activeCourse && activeLesson && window.UseasStore) {
            const liveRatio = Math.min(1.0, actualWatchedSeconds / dur);
            const progress = window.UseasStore.getCourseProgress(activeCourse.id);

            if (curr >= dur - 1 && actualWatchedSeconds >= dur * 0.90 && !isLessonVideoCompleted && !progress.completedLessons.includes(activeLesson.id)) {
                isLessonVideoCompleted = true;
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
                updatePlayerProgressUI(newProgress, 1.0);
                renderLessonsPlaylist();
                renderCourses();
                updateNextBtnLockState();
                showToast('🎉 Full video watched & verified! Next lesson unlocked.', 'success');
            } else {
                updatePlayerProgressUI(progress, liveRatio);
            }
        }
    }

    // Initialize App
    init();

    function init() {
        setupAuthHandlers();
        setupEventListeners();
        updateStudentHeaderUI();
        renderCourses();

        window.addEventListener('courses-updated', () => renderCourses());
        window.addEventListener('firebase-ready', () => renderCourses());
        window.addEventListener('focus', () => renderCourses());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) renderCourses();
        });
        window.addEventListener('storage', (e) => {
            if (!e.key || e.key === 'useas_courses_v1') {
                renderCourses();
            }
        });
        window.addEventListener('student-auth-changed', () => {
            updateStudentHeaderUI();
            renderCourses();
        });
        window.addEventListener('progress-updated', () => {
            renderCourses();
            if (activeCourse && window.UseasStore) {
                const progress = window.UseasStore.getCourseProgress(activeCourse.id);
                updatePlayerProgressUI(progress);
                renderLessonsPlaylist();
            }
        });

        window.addEventListener('beforeunload', () => {
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && activeCourse && activeLesson && window.UseasStore) {
                try {
                    const curr = ytPlayer.getCurrentTime() || 0;
                    if (curr > 1) {
                        window.UseasStore.saveLessonTimestamp(activeCourse.id, activeLesson.id, curr);
                    }
                } catch (e) {}
            }
        });
    }

    // YouTube IFrame API Handlers
    window.onYouTubeIframeAPIReady = function() {
        initYTPlayer();
    };

    function initYTPlayer(videoId = '') {
        try {
            if (typeof YT !== 'undefined' && YT.Player) {
                if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                    if (videoId) {
                        if (pendingResumeTimestamp > 2) {
                            ytPlayer.loadVideoById({ videoId: videoId, startSeconds: Math.floor(pendingResumeTimestamp) });
                        } else {
                            ytPlayer.loadVideoById(videoId);
                        }
                    }
                } else {
                    ytPlayer = new YT.Player('youtubeIframe', {
                        host: 'https://www.youtube-nocookie.com',
                        width: '100%',
                        height: '100%',
                        videoId: videoId || undefined,
                        playerVars: {
                            'autoplay': 1,
                            'controls': 0,
                            'rel': 0,
                            'modestbranding': 1,
                            'disablekb': 1,
                            'iv_load_policy': 3,
                            'cc_load_policy': 0,
                            'playsinline': 1,
                            'fs': 0,
                            'enablejsapi': 1
                        },
                        events: {
                            'onReady': (ev) => {
                                try {
                                    ev.target.unloadModule('captions');
                                    ev.target.unloadModule('cc');
                                } catch (e) {}
                            },
                            'onStateChange': onPlayerStateChange,
                            'onError': onPlayerError
                        }
                    });
                }
            }
        } catch (e) {
            console.log('Video player init notice:', e);
        }
    }

    function onPlayerError(event) {
        console.warn('Video player notice/error code:', event ? event.data : 'unknown');
        hasPlayerError = true;
        hideProctorGate();
        updateLiveAlertBanner(false);
        updatePausedMask(false);
        updateCornerLogoShield();
        const fallbackCard = document.getElementById('restrictedFallbackCard');
        const bigCenterBtn = document.getElementById('bigCenterPlayBtn');
        const controlsBar = document.getElementById('customVideoControlsBar');
        const watchBtn = document.getElementById('watchOnYtBtn');

        if (fallbackCard) fallbackCard.style.display = 'flex';
        if (bigCenterBtn) bigCenterBtn.style.display = 'none';
        if (controlsBar) controlsBar.style.display = 'none';

        if (watchBtn && currentVideoId) {
            watchBtn.href = `https://www.youtube.com/watch?v=${currentVideoId}`;
        }
    }

    function handleVideoEndedVerification() {
        if (!activeCourse || !activeLesson || !window.UseasStore) return;
        const dur = getYTDuration();
        const requiredWatch = dur > 0 ? dur * 0.90 : 0;

        if (isLessonVideoCompleted || dur <= 0 || actualWatchedSeconds >= requiredWatch) {
            isLessonVideoCompleted = true;
            const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
            updatePlayerProgressUI(newProgress);
            renderLessonsPlaylist();
            renderCourses();
            updateNextBtnLockState();
            updateVideoAnalysisUI(dur, dur);
            showToast('🎉 Full video watched & verified! Next lesson unlocked.', 'success');
        } else {
            const rewindTo = Math.max(0, Math.min(maxWatchedTime, actualWatchedSeconds));
            maxWatchedTime = rewindTo;
            latestYtCurrentTime = rewindTo;
            sendYTCommand('seekTo', [rewindTo, true]);
            sendYTCommand('pauseVideo');
            updateVideoAnalysisUI(rewindTo, dur);
            showProctorGate(
                'incomplete',
                'Full Video Watch Required',
                `Video length is ${formatTime(dur)}, but you watched only ${formatTime(actualWatchedSeconds)}. Next video stays locked until you watch the full video without skipping.`,
                'Continue Watching'
            );
            showToast('🔒 Incomplete watch time! Next video remains locked.', 'warning');
        }
    }

    function onPlayerStateChange(event) {
        if (event && typeof event.data === 'number') {
            latestYtPlayerState = event.data;
            if (event.data === 1) {
                if (proctorGateActive || (activeLesson && (activeLesson.type || 'video') === 'video' && !isLessonCameraLive())) {
                    sendYTCommand('pauseVideo');
                    updatePausedMask(false, 'Video Paused');
                    return;
                }
                isCurrentlyPlaying = true;
                lastWatchTickMs = Date.now();
                updatePlayPauseUI(true);
                updatePausedMask(true);
                triggerTopBarShield(4200);
                handleMouseMoveControls();
                try {
                    if (ytPlayer && typeof ytPlayer.unloadModule === 'function') {
                        ytPlayer.unloadModule('captions');
                        ytPlayer.unloadModule('cc');
                    }
                } catch (e) {}
            } else if (event.data === 3) {
                updatePausedMask(false, 'Loading Lesson Video...');
                triggerTopBarShield(4500);
            } else if (event.data === 2 || event.data === 0 || event.data === -1) {
                isCurrentlyPlaying = false;
                updatePlayPauseUI(false);
                updatePausedMask(false, event.data === 0 ? 'Lesson Completed' : 'Video Paused');
                const controlsBar = document.getElementById('customVideoControlsBar');
                if (controlsBar) controlsBar.classList.remove('controls-hidden');
            }
        }

        if (event && (event.data === 1 || event.data === 3) && pendingResumeTimestamp > 2) {
            const resumeTime = pendingResumeTimestamp;
            pendingResumeTimestamp = 0;
            if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
                ytPlayer.seekTo(resumeTime, true);
            }
            const dur = (ytPlayer && typeof ytPlayer.getDuration === 'function') ? (ytPlayer.getDuration() || 0) : 0;
            const pct = dur > 0 ? Math.round((resumeTime / dur) * 100) : 0;
            showToast(`▶ Resumed playback from ${formatTime(resumeTime)}${pct > 0 ? ` (${pct}%)` : ''}`, 'info');
        }

        if (event && event.data === 0) {
            handleVideoEndedVerification();
        }
    }

    function setupEventListeners() {
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value.toLowerCase();
                renderCourses();
            });
        }

        if (categoryContainer) {
            categoryContainer.addEventListener('click', (e) => {
                const target = e.target.closest('.tag-btn');
                if (!target) return;

                document.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('active'));
                target.classList.add('active');
                activeCategory = target.getAttribute('data-category');
                renderCourses();
            });
        }

        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', closePlayerModal);
        }

        if (playerModal) {
            playerModal.addEventListener('click', (e) => {
                if (e.target === playerModal) {
                    closePlayerModal();
                }
            });
        }

        if (videoClickOverlay) {
            videoClickOverlay.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePlayPause();
            });
            videoClickOverlay.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleFullscreen();
            });
        }

        const bigCenterPlayBtn = document.getElementById('bigCenterPlayBtn');
        if (bigCenterPlayBtn) {
            bigCenterPlayBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePlayPause();
            });
        }

        if (prevLessonBtn) {
            prevLessonBtn.addEventListener('click', () => navigateLesson(-1));
        }
        if (nextLessonBtn) {
            nextLessonBtn.addEventListener('click', () => navigateLesson(1));
        }

        const customPlayPauseBtn = document.getElementById('customPlayPauseBtn');
        const customRewind10Btn = document.getElementById('customRewind10Btn');
        const customScrubSlider = document.getElementById('customScrubSlider');

        if (customPlayPauseBtn) customPlayPauseBtn.addEventListener('click', () => togglePlayPause());
        if (customRewind10Btn) customRewind10Btn.addEventListener('click', () => rewind10Seconds());

        const toggleProctorCamBtn = document.getElementById('toggleProctorCamBtn');
        const shareScreenBtn = document.getElementById('shareScreenBtn');
        const proctorGateActionBtn = document.getElementById('proctorGateActionBtn');
        const proctorGateShareBtn = document.getElementById('proctorGateShareBtn');

        if (toggleProctorCamBtn) {
            toggleProctorCamBtn.addEventListener('click', () => requestLessonCamera(true));
        }
        if (shareScreenBtn) {
            shareScreenBtn.addEventListener('click', () => requestLessonScreenShare());
        }
        if (proctorGateShareBtn) {
            proctorGateShareBtn.addEventListener('click', () => requestLessonScreenShare());
        }
        if (proctorGateActionBtn) {
            proctorGateActionBtn.addEventListener('click', () => {
                if (!isLessonCameraLive()) {
                    requestLessonCamera(true);
                } else {
                    awayStreakSeconds = 0;
                    hideProctorGate();
                    lastWatchTickMs = Date.now();
                    isCurrentlyPlaying = true;
                    sendYTCommand('playVideo');
                    updatePlayPauseUI(true);
                }
            });
        }

        const customMuteBtn = document.getElementById('customMuteBtn');
        const customVolumeSlider = document.getElementById('customVolumeSlider');

        if (customMuteBtn) customMuteBtn.addEventListener('click', () => toggleMute());
        if (customVolumeSlider) {
            customVolumeSlider.addEventListener('input', (e) => {
                handleVolumeChange(parseFloat(e.target.value));
            });
        }

        const toggleNotesBtn = document.getElementById('toggleNotesBtn');
        const lessonNotesInput = document.getElementById('lessonNotesInput');
        const saveLessonNotesBtn = document.getElementById('saveLessonNotesBtn');
        const insertNoteTimestampBtn = document.getElementById('insertNoteTimestampBtn');
        const downloadLessonNotesBtn = document.getElementById('downloadLessonNotesBtn');
        const notesSaveStatus = document.getElementById('notesSaveStatus');

        const persistCurrentLessonNotes = (showToastMsg = false) => {
            if (!activeCourse || !activeLesson || !window.UseasStore || !lessonNotesInput) return;
            window.UseasStore.saveLessonNotes(activeCourse.id, activeLesson.id, lessonNotesInput.value);
            if (notesSaveStatus) {
                notesSaveStatus.textContent = 'Saved';
                notesSaveStatus.classList.remove('saving');
            }
            if (showToastMsg) showToast('📝 Lesson notes saved!', 'success');
        };

        if (lessonNotesInput) {
            lessonNotesInput.addEventListener('input', () => {
                if (notesSaveStatus) {
                    notesSaveStatus.textContent = 'Saving...';
                    notesSaveStatus.classList.add('saving');
                }
                if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
                notesSaveTimeout = setTimeout(() => persistCurrentLessonNotes(false), 400);
            });
        }

        if (saveLessonNotesBtn) {
            saveLessonNotesBtn.addEventListener('click', () => persistCurrentLessonNotes(true));
        }

        if (insertNoteTimestampBtn && lessonNotesInput) {
            insertNoteTimestampBtn.addEventListener('click', () => {
                const stamp = `[${formatTime(getYTCurrentTime())}] `;
                const start = lessonNotesInput.selectionStart || lessonNotesInput.value.length;
                const val = lessonNotesInput.value;
                const prefix = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
                lessonNotesInput.value = val.slice(0, start) + prefix + stamp + val.slice(start);
                lessonNotesInput.focus();
                persistCurrentLessonNotes(false);
            });
        }

        if (downloadLessonNotesBtn && lessonNotesInput) {
            downloadLessonNotesBtn.addEventListener('click', () => {
                const text = lessonNotesInput.value.trim();
                if (!text) {
                    showToast('📝 Write some notes first before downloading.', 'info');
                    return;
                }
                const title = (activeLesson && activeLesson.title) ? activeLesson.title.replace(/[^a-z0-9]+/gi, '_') : 'lesson_notes';
                const header = `${activeCourse ? activeCourse.title : 'Course'} — ${activeLesson ? activeLesson.title : 'Lesson'}\n${'='.repeat(40)}\n\n`;
                const blob = new Blob([header + text], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${title}_notes.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('⬇️ Notes downloaded!', 'success');
            });
        }

        if (toggleNotesBtn) {
            toggleNotesBtn.addEventListener('click', () => {
                const container = document.getElementById('videoContainer');
                if (document.fullscreenElement || (container && container.classList.contains('is-fullscreen'))) {
                    toggleFullscreen();
                }
                const notesCard = document.getElementById('lessonNotesCard');
                if (notesCard) {
                    notesCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                if (lessonNotesInput) {
                    setTimeout(() => lessonNotesInput.focus(), 200);
                }
            });
        }

        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => toggleFullscreen());
        }

        const restrictedCompleteBtn = document.getElementById('restrictedCompleteBtn');
        if (restrictedCompleteBtn) {
            restrictedCompleteBtn.addEventListener('click', () => {
                if (!activeCourse || !activeLesson || !window.UseasStore) return;
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
                updatePlayerProgressUI(newProgress);
                renderLessonsPlaylist();
                renderCourses();
                showToast('🎉 Lesson video marked complete!', 'success');
                navigateLesson(1);
            });
        }

        if (videoWrapper) {
            videoWrapper.addEventListener('mousemove', () => handleMouseMoveControls());
            videoWrapper.addEventListener('mouseleave', () => {
                if (isCurrentlyPlaying) {
                    const controlsBar = document.getElementById('customVideoControlsBar');
                    if (controlsBar) controlsBar.classList.add('controls-hidden');
                }
            });
        }

        if (customScrubSlider) {
            customScrubSlider.addEventListener('mousedown', () => { isScrubbing = true; });
            customScrubSlider.addEventListener('touchstart', () => { isScrubbing = true; });

            customScrubSlider.addEventListener('keydown', (e) => {
                if (['ArrowRight', 'ArrowUp', 'PageUp', 'End'].includes(e.key) && !isLessonVideoCompleted) {
                    e.preventDefault();
                    e.stopPropagation();
                    blockSkipAttempt(getYTDuration());
                }
            });

            customScrubSlider.addEventListener('input', (e) => {
                const pct = parseFloat(e.target.value);
                const dur = getYTDuration();
                if (dur > 0) {
                    const targetSec = (pct / 100) * dur;
                    if (!isLessonVideoCompleted && targetSec > maxWatchedTime + 0.5) {
                        blockSkipAttempt(dur);
                        return;
                    }

                    const fill = document.getElementById('customScrubFill');
                    if (fill) fill.style.width = `${pct}%`;

                    const timeDisplay = document.getElementById('customTimeDisplay');
                    if (timeDisplay) {
                        timeDisplay.textContent = `${formatTime(targetSec)} / ${formatTime(dur)}`;
                    }
                }
            });

            const commitSeek = () => {
                if (!isScrubbing) return;
                isScrubbing = false;
                const dur = getYTDuration();
                if (dur > 0) {
                    const pct = parseFloat(customScrubSlider.value);
                    const targetSec = (pct / 100) * dur;

                    if (!isLessonVideoCompleted && targetSec > maxWatchedTime + 0.5) {
                        blockSkipAttempt(dur);
                    } else {
                        latestYtCurrentTime = targetSec;
                        triggerTopBarShield(4200);
                        sendYTCommand('seekTo', [targetSec, true]);
                    }
                }
            };

            customScrubSlider.addEventListener('mouseup', commitSeek);
            customScrubSlider.addEventListener('touchend', commitSeek);
            customScrubSlider.addEventListener('change', commitSeek);
        }

        // Background App / External Website Opening Block + Anti-Inspect while watching course videos
        document.addEventListener('click', (e) => {
            if (!playerModal || !playerModal.classList.contains('active')) return;
            if (!activeLesson || (activeLesson.type || 'video') !== 'video' || hasPlayerError) return;
            const anchor = e.target && e.target.closest ? e.target.closest('a') : null;
            if (!anchor) return;
            const href = (anchor.getAttribute('href') || '').trim();
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                e.preventDefault();
                e.stopPropagation();
                handleBackgroundSwitchViolation('Opening another website while watching a course video is blocked.');
            }
        }, true);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                handleBackgroundSwitchViolation('Switched to another browser tab or minimized window.');
            }
        });

        window.addEventListener('blur', () => {
            if (!isRequestingMediaPermission) {
                handleBackgroundSwitchViolation('Switched to another application or external website.');
            }
        });

        document.addEventListener('contextmenu', (e) => {
            if (playerModal && playerModal.classList.contains('active') && activeLesson && (activeLesson.type || 'video') === 'video') {
                e.preventDefault();
            }
        });

        document.addEventListener('keydown', (e) => {
            const tag = e.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

            if (playerModal && playerModal.classList.contains('active')) {
                const upperKey = (e.key || '').toUpperCase();
                if ((e.ctrlKey || e.metaKey) && ['T', 'N', 'L'].includes(upperKey)) {
                    e.preventDefault();
                    handleBackgroundSwitchViolation('Opening a new browser tab or external website is blocked during video playback.');
                    return;
                }
                if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(upperKey)) || (e.ctrlKey && upperKey === 'U')) {
                    e.preventDefault();
                    showToast('🚫 Developer tools blocked during course playback.', 'warning');
                    return;
                }
                if (e.code === 'Space' || e.key === ' ' || e.key === 'k' || e.key === 'K') {
                    e.preventDefault();
                    togglePlayPause();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    rewind10Seconds();
                } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'End' || upperKey === 'L' || (/^[0-9]$/.test(e.key || ''))) {
                    e.preventDefault();
                    if (!isLessonVideoCompleted) {
                        blockSkipAttempt(getYTDuration());
                    }
                } else if (e.key === 'm' || e.key === 'M') {
                    e.preventDefault();
                    toggleMute();
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    toggleFullscreen();
                } else if (e.key === 'Escape') {
                    const container = document.getElementById('videoContainer');
                    if (document.fullscreenElement || document.webkitFullscreenElement) return;
                    if (container && container.classList.contains('is-fullscreen')) {
                        container.classList.remove('is-fullscreen');
                        updateFullscreenBtnUI(false);
                        return;
                    }
                    closePlayerModal();
                }
            }
        });
    }

    function showPlayPauseAnim(type) {
        const wrap = document.getElementById('playPauseIconWrap');
        const icon = document.getElementById('playPauseIcon');
        if (!wrap || !icon) return;

        icon.className = type === 'play' ? 'fa-solid fa-play' : 'fa-solid fa-pause';
        wrap.classList.add('show');
        setTimeout(() => {
            wrap.classList.remove('show');
        }, 650);
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let iconClass = 'fa-circle-info';
        if (type === 'success') iconClass = 'fa-circle-check';
        else if (type === 'warning') iconClass = 'fa-triangle-exclamation';
        else if (type === 'danger' || type === 'error') iconClass = 'fa-circle-xmark';

        toast.innerHTML = `
            <div class="toast-icon-wrapper">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    function getSafeAllCourses() {
        if (window.UseasStore && typeof window.UseasStore.getCourses === 'function') {
            const storeCourses = window.UseasStore.getCourses();
            if (Array.isArray(storeCourses) && storeCourses.length > 0) {
                return storeCourses;
            }
        }
        try {
            const raw = localStorage.getItem('useas_courses_v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.filter(c => c && typeof c === 'object' && c.id);
                }
            }
        } catch (e) {}
        return [];
    }

    // Render Course Cards
    function renderCourses() {
        if (!coursesGrid) return;

        const allCourses = getSafeAllCourses();
        const filtered = allCourses.filter(course => {
            if (!course || !course.id) return false;
            const matchesCat = activeCategory === 'all' || course.category === activeCategory;
            const titleStr = (course.title || '').toLowerCase();
            const descStr = (course.description || '').toLowerCase();
            const matchesSearch = titleStr.includes(searchQuery) || descStr.includes(searchQuery);
            return matchesCat && matchesSearch;
        });

        if (filtered.length === 0) {
            if (activeNoItemAnim) {
                try { activeNoItemAnim.destroy(); } catch (e) {}
                activeNoItemAnim = null;
            }

            coursesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
                    <div id="lottieNoItemWrap" style="width: 280px; height: 220px; margin: 0 auto; display: flex; align-items: center; justify-content: center;"></div>
                    <h3 style="font-size: 1.5rem; font-weight: 800; color: var(--text-main); margin-top: 1rem; margin-bottom: 0.5rem;">No Item Found</h3>
                    <p style="color: var(--text-muted); font-size: 0.95rem; max-width: 440px; margin: 0 auto;">We couldn't find any courses matching your search. Try searching for something else!</p>
                </div>
            `;

            const wrap = document.getElementById('lottieNoItemWrap');
            if (wrap && window.lottie) {
                const animData = window.NO_ITEM_ANIMATION_DATA || noItemAnimData;
                try {
                    if (animData) {
                        activeNoItemAnim = window.lottie.loadAnimation({
                            container: wrap,
                            renderer: 'svg',
                            loop: true,
                            autoplay: true,
                            animationData: animData
                        });
                    } else {
                        activeNoItemAnim = window.lottie.loadAnimation({
                            container: wrap,
                            renderer: 'svg',
                            loop: true,
                            autoplay: true,
                            path: 'animations/no-item-found.json'
                        });
                    }
                } catch (err) {}
            }
            return;
        }

        if (activeNoItemAnim) {
            try { activeNoItemAnim.destroy(); } catch (e) {}
            activeNoItemAnim = null;
        }

        const currentStudent = window.UseasStore ? window.UseasStore.getCurrentStudent() : null;

        coursesGrid.innerHTML = filtered.map(course => {
            const totalLessons = course.lessons ? course.lessons.length : 0;
            const isRegistered = (currentStudent && window.UseasStore) ? window.UseasStore.isStudentRegisteredForCourse(course.id, currentStudent) : false;

            return `
                <div class="course-card" data-course-id="${course.id}">
                    <div class="card-thumb-wrap">
                        <img src="${course.thumbnail}" alt="${course.title}" class="card-thumb" onerror="this.src='https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80'">
                    </div>
                    <div class="card-content">
                        <span class="badge-category">${course.category || 'General'}</span>
                        <h3 class="card-title">${course.title}</h3>
                        <p class="card-desc">${course.description}</p>
                        
                        <div class="card-meta">
                            <span class="meta-item">
                                <i class="fa-solid fa-video"></i> ${totalLessons} Lessons
                            </span>
                            <span class="meta-item">
                                <i class="fa-regular fa-clock"></i> ${course.level || 'All Levels'}
                            </span>
                        </div>

                        ${isRegistered ? `
                            <button class="btn btn-success btn-course-action" style="margin-top: 1rem; width: 100%;">
                                <i class="fa-solid fa-circle-check" style="color: #ffffff;"></i> Joined
                            </button>
                        ` : `
                            <button class="btn btn-primary btn-course-action" style="margin-top: 1rem; width: 100%; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%); border: none;">
                                <i class="fa-solid fa-user-pen"></i> Register for Course
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        coursesGrid.querySelectorAll('.course-card').forEach(card => {
            card.addEventListener('click', () => {
                const courseId = card.getAttribute('data-course-id');
                const student = window.UseasStore ? window.UseasStore.getCurrentStudent() : null;
                if (!student) {
                    showLockedModal();
                    return;
                }
                const isReg = window.UseasStore.isStudentRegisteredForCourse(courseId, student);
                if (isReg) {
                    openCoursePlayer(courseId);
                } else {
                    openCourseRegistrationModal(courseId);
                }
            });
        });
    }

    window.addEventListener('registrations-updated', () => renderCourses());

    // Course Locked Modal Handlers
    const lockedModal = document.getElementById('lockedModal');
    const closeLockedBtn = document.getElementById('closeLockedBtn');
    const lockedLoginBtn = document.getElementById('lockedLoginBtn');
    const lockedLottieWrap = document.getElementById('lockedLottieWrap');

    function showLockedModal() {
        if (!lockedModal) return;

        lockedModal.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (activeLockedAnim) {
            try { activeLockedAnim.destroy(); } catch (e) {}
            activeLockedAnim = null;
        }

        if (lockedLottieWrap && window.lottie) {
            const animData = window.LOCKED_ANIMATION_DATA || lockedAnimData;
            try {
                if (animData) {
                    activeLockedAnim = window.lottie.loadAnimation({
                        container: lockedLottieWrap,
                        renderer: 'svg',
                        loop: true,
                        autoplay: true,
                        animationData: animData
                    });
                } else {
                    activeLockedAnim = window.lottie.loadAnimation({
                        container: lockedLottieWrap,
                        renderer: 'svg',
                        loop: true,
                        autoplay: true,
                        path: 'animations/locked.json'
                    });
                }
            } catch (err) {}
        }
    }

    function closeLockedModal() {
        if (!lockedModal) return;
        lockedModal.classList.remove('active');
        document.body.style.overflow = 'auto';
        if (activeLockedAnim) {
            try { activeLockedAnim.destroy(); } catch (e) {}
            activeLockedAnim = null;
        }
    }

    if (closeLockedBtn) closeLockedBtn.addEventListener('click', closeLockedModal);
    if (lockedModal) {
        lockedModal.addEventListener('click', (e) => {
            if (e.target === lockedModal) closeLockedModal();
        });
    }
    if (lockedLoginBtn) {
        lockedLoginBtn.addEventListener('click', () => {
            closeLockedModal();
            const authModal = document.getElementById('authModal');
            if (authModal) {
                authModal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    }

    // Course Registration Modal Handlers
    const courseRegisterModal = document.getElementById('courseRegisterModal');
    const closeRegisterBtn = document.getElementById('closeRegisterBtn');
    const courseRegisterForm = document.getElementById('courseRegisterForm');
    const regCourseTitleSubtitle = document.getElementById('regCourseTitleSubtitle');

    function openCourseRegistrationModal(courseId) {
        if (!window.UseasStore) return;
        const currentStudent = window.UseasStore.getCurrentStudent();
        if (!currentStudent) {
            showLockedModal();
            return;
        }

        const course = window.UseasStore.getCourseById(courseId) || getSafeAllCourses().find(c => c.id === courseId);
        if (!course) return;

        document.getElementById('regCourseIdInput').value = courseId;
        if (regCourseTitleSubtitle) {
            regCourseTitleSubtitle.textContent = `Registering for: ${course.title}`;
        }

        document.getElementById('regFullNameInput').value = currentStudent.fullName || '';
        document.getElementById('regSucCodeInput').value = currentStudent.sucCode || '';
        document.getElementById('regEmailInput').value = currentStudent.email || '';
        document.getElementById('regCollegeNameInput').value = currentStudent.collegeName || '';
        document.getElementById('regPresentStudyInput').value = currentStudent.presentStudy || '';

        if (courseRegisterModal) {
            courseRegisterModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCourseRegistrationModal() {
        if (courseRegisterModal) {
            courseRegisterModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }

    if (closeRegisterBtn) closeRegisterBtn.addEventListener('click', closeCourseRegistrationModal);
    if (courseRegisterModal) {
        courseRegisterModal.addEventListener('click', (e) => {
            if (e.target === courseRegisterModal) closeCourseRegistrationModal();
        });
    }

    if (courseRegisterForm) {
        courseRegisterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!window.UseasStore) return;
            const currentStudent = window.UseasStore.getCurrentStudent();
            if (!currentStudent) {
                closeCourseRegistrationModal();
                showLockedModal();
                return;
            }

            const courseId = document.getElementById('regCourseIdInput').value;
            const course = window.UseasStore.getCourseById(courseId) || getSafeAllCourses().find(c => c.id === courseId);
            const fullName = document.getElementById('regFullNameInput').value.trim();
            const sucCode = document.getElementById('regSucCodeInput').value.trim();
            const collegeName = document.getElementById('regCollegeNameInput').value.trim();
            const email = document.getElementById('regEmailInput').value.trim();
            const presentStudy = document.getElementById('regPresentStudyInput').value.trim();

            const res = window.UseasStore.registerCourse({
                courseId,
                courseTitle: course ? course.title : '',
                studentId: currentStudent.id,
                fullName,
                sucCode,
                collegeName,
                email,
                presentStudy
            });

            if (res.success) {
                closeCourseRegistrationModal();
                showToast('Registration Successful! You have joined this course.', 'success');
                renderCourses();
                openCoursePlayer(courseId);
            }
        });
    }

    // Open Course Player Modal
    function openCoursePlayer(courseId, targetLessonId = null) {
        if (!window.UseasStore) return;
        const currentStudent = window.UseasStore.getCurrentStudent();
        if (!currentStudent) {
            showLockedModal();
            return;
        }

        const isRegistered = window.UseasStore.isStudentRegisteredForCourse(courseId, currentStudent);
        if (!isRegistered) {
            openCourseRegistrationModal(courseId);
            return;
        }

        const course = window.UseasStore.getCourseById(courseId) || getSafeAllCourses().find(c => c.id === courseId);
        if (!course) return;

        activeCourse = course;

        if (!course.lessons || course.lessons.length === 0) {
            alert('This course does not have any YouTube videos added yet.');
            return;
        }

        const progress = window.UseasStore.getCourseProgress(courseId);
        let startLessonId = targetLessonId || progress.lastWatchedLessonId;
        let foundIdx = course.lessons.findIndex(l => l.id === startLessonId);
        if (foundIdx < 0 || (foundIdx > 0 && !progress.completedLessons.includes(course.lessons[foundIdx - 1].id))) {
            foundIdx = course.lessons.findIndex((l, idx) => idx === 0 || progress.completedLessons.includes(course.lessons[idx - 1].id));
            if (foundIdx < 0) foundIdx = 0;
        }
        activeLesson = course.lessons[foundIdx];

        modalCourseTitle.textContent = course.title;
        
        playerModal.classList.add('active');
        document.body.style.overflow = 'hidden';

        loadLesson(activeLesson.id);
        renderLessonsPlaylist();
    }

    let activeWebcamStream = null;

    function loadLesson(lessonId) {
        if (!window.UseasStore) return;
        const lesson = activeCourse.lessons.find(l => l.id === lessonId);
        if (!lesson) return;

        activeLesson = lesson;
        window.UseasStore.setLastWatched(activeCourse.id, lesson.id);

        const type = lesson.type || 'video';
        const videoWrap = document.getElementById('videoWrapper');
        const videoContainer = document.getElementById('videoContainer');
        const textView = document.getElementById('textArticleView');
        const testView = document.getElementById('testOverviewView');
        const proctorPanel = document.getElementById('videoProctorPanel');

        stopCustomTimeTracker();
        hideProctorGate();

        const notesCard = document.getElementById('lessonNotesCard');
        const notesInput = document.getElementById('lessonNotesInput');
        const notesStatus = document.getElementById('notesSaveStatus');
        if (notesInput && window.UseasStore) {
            notesInput.value = window.UseasStore.getLessonNotes(activeCourse.id, lesson.id);
            if (notesStatus) {
                notesStatus.textContent = 'Saved';
                notesStatus.classList.remove('saving');
            }
        }
        if (notesCard) {
            notesCard.style.display = type === 'test' ? 'none' : 'flex';
        }

        if (type === 'video') {
            hasPlayerError = false;
            updatePausedMask(false, 'Protected Course Video');
            const fallbackCard = document.getElementById('restrictedFallbackCard');
            const controlsBar = document.getElementById('customVideoControlsBar');
            const bigCenterBtn = document.getElementById('bigCenterPlayBtn');
            if (fallbackCard) fallbackCard.style.display = 'none';
            if (controlsBar) controlsBar.style.display = 'flex';
            if (bigCenterBtn) bigCenterBtn.style.display = 'flex';

            if (videoContainer) videoContainer.style.display = 'flex';
            if (videoWrap) videoWrap.style.display = 'block';
            if (proctorPanel) proctorPanel.style.display = 'grid';
            if (textView) textView.style.display = 'none';
            if (testView) testView.style.display = 'none';

            const savedTimestamp = window.UseasStore.getLessonTimestamp(activeCourse.id, lesson.id);
            const currentProgress = window.UseasStore.getCourseProgress(activeCourse.id);
            const isLessonDone = currentProgress.completedLessons.includes(lesson.id);
            isLessonVideoCompleted = isLessonDone;
            maxWatchedTime = isLessonDone ? 999999 : (savedTimestamp || 0);
            actualWatchedSeconds = isLessonDone ? 0 : (savedTimestamp || 0);
            lastWatchTickMs = Date.now();
            skipViolationCount = 0;
            lastSkipBlockedAlertMs = 0;
            backgroundViolationCount = 0;
            notListeningCount = 0;
            awayStreakSeconds = 0;
            latestYtCurrentTime = savedTimestamp || 0;
            latestYtDuration = 0;
            const scrubSliderReset = document.getElementById('customScrubSlider');
            const scrubFillReset = document.getElementById('customScrubFill');
            const scrubWatchedReset = document.getElementById('customScrubWatched');
            const timeDisplayReset = document.getElementById('customTimeDisplay');
            const remainingDisplayReset = document.getElementById('customRemainingDisplay');
            if (scrubSliderReset) scrubSliderReset.value = 0;
            if (scrubFillReset) scrubFillReset.style.width = '0%';
            if (scrubWatchedReset) scrubWatchedReset.style.width = isLessonDone ? '100%' : '0%';
            if (timeDisplayReset) timeDisplayReset.textContent = `${formatTime(latestYtCurrentTime)} / 0:00`;
            if (remainingDisplayReset) remainingDisplayReset.textContent = '0:00 (0s left)';
            updateVideoAnalysisUI(latestYtCurrentTime, 0);

            pendingResumeTimestamp = (!isLessonDone && savedTimestamp > 2) ? savedTimestamp : 0;
            const startParam = pendingResumeTimestamp > 2 ? `&start=${Math.floor(pendingResumeTimestamp)}` : '';

            const videoId = lesson.videoId || window.UseasStore.extractYoutubeId(lesson.videoUrl);
            currentVideoId = videoId;
            const isHttp = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && window.location.origin && window.location.origin !== 'null';
            const originParam = isHttp ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
            const camReady = isLessonCameraLive();
            const autoplayParam = camReady ? 1 : 0;
            const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${autoplayParam}&enablejsapi=1&controls=0&rel=0&modestbranding=1&disablekb=1&iv_load_policy=3&cc_load_policy=0&playsinline=1&fs=0${startParam}${originParam}`;

            if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                try {
                    if (pendingResumeTimestamp > 2) {
                        ytPlayer.loadVideoById({ videoId: videoId, startSeconds: Math.floor(pendingResumeTimestamp) });
                    } else {
                        ytPlayer.loadVideoById(videoId);
                    }
                    if (!camReady) sendYTCommand('pauseVideo');
                } catch (e) {
                    if (youtubeIframe) youtubeIframe.src = embedUrl;
                }
            } else {
                if (youtubeIframe) youtubeIframe.src = embedUrl;
                initYTPlayer(videoId);
            }

            startCustomTimeTracker();

            if (!camReady) {
                showProctorGate(
                    'camera',
                    'Camera Access Required',
                    'Allow camera access to verify you are watching and listening. You can also share your screen for proctored playback.',
                    'Enable Camera & Play'
                );
                requestLessonCamera(true);
            } else {
                startAttentionMonitor();
            }
        } else if (type === 'text') {
            if (videoContainer) videoContainer.style.display = 'none';
            if (proctorPanel) proctorPanel.style.display = 'none';
            if (textView) textView.style.display = 'block';
            if (testView) testView.style.display = 'none';

            sendYTCommand('pauseVideo');

            const articleTitle = document.getElementById('articleTitle');
            const articleBody = document.getElementById('articleBody');
            const completeArticleBtn = document.getElementById('completeArticleBtn');

            if (articleTitle) articleTitle.textContent = lesson.title;
            if (articleBody) articleBody.textContent = lesson.textContent || 'No article content provided for this lesson.';

            if (completeArticleBtn) {
                completeArticleBtn.onclick = () => {
                    const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, lesson.id, true);
                    updatePlayerProgressUI(newProgress);
                    renderLessonsPlaylist();
                    renderCourses();
                    updateNextBtnLockState();
                    showToast('🎉 Article reading completed!', 'success');
                    navigateLesson(1);
                };
            }
        } else if (type === 'test') {
            if (videoContainer) videoContainer.style.display = 'none';
            if (proctorPanel) proctorPanel.style.display = 'none';
            if (textView) textView.style.display = 'none';
            if (testView) testView.style.display = 'block';

            sendYTCommand('pauseVideo');

            const testOverviewTitle = document.getElementById('testOverviewTitle');
            const testOverviewDesc = document.getElementById('testOverviewDesc');
            const examStatusBox = document.getElementById('examStatusBox');
            const openExamPrecheckBtn = document.getElementById('openExamPrecheckBtn');

            if (testOverviewTitle) testOverviewTitle.textContent = lesson.title;
            if (testOverviewDesc) testOverviewDesc.textContent = lesson.description || (lesson.examData && lesson.examData.instructions) || 'Complete this online examination to advance in the course.';

            const examRes = window.UseasStore.getExamResult(activeCourse.id, lesson.id);
            if (examStatusBox) {
                if (examRes) {
                    const color = examRes.passed ? 'var(--accent-green)' : 'var(--accent-red)';
                    const icon = examRes.passed ? 'fa-circle-check' : 'fa-circle-xmark';
                    examStatusBox.innerHTML = `
                        <div style="background: rgba(255,255,255,0.8); border: 1px solid ${color}; padding: 0.85rem; border-radius: var(--radius-sm); display: inline-block;">
                            <i class="fa-solid ${icon}" style="color: ${color}; font-size: 1.1rem; margin-right: 0.4rem;"></i>
                            <strong>Previous Result:</strong> ${examRes.score}/${examRes.totalQuestions} (${examRes.percentage}%) - 
                            <span style="color: ${color}; font-weight: 800;">${examRes.passed ? 'PASSED' : 'FAILED (60% Required)'}</span>
                        </div>
                    `;
                    if (openExamPrecheckBtn) openExamPrecheckBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Retake Proctored Exam`;
                } else {
                    examStatusBox.innerHTML = `
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Status: Not Attempted Yet</div>
                    `;
                    if (openExamPrecheckBtn) openExamPrecheckBtn.innerHTML = `<i class="fa-solid fa-circle-play"></i> Start Proctored Exam`;
                }
            }

            if (openExamPrecheckBtn) {
                openExamPrecheckBtn.onclick = () => openPreExamModal();
            }
        }

        modalLessonTitle.textContent = lesson.title;
        modalLessonDesc.textContent = lesson.description || 'Follow the step instructions to advance through the course.';

        const currentIdx = activeCourse.lessons.findIndex(l => l.id === lesson.id);
        modalLessonCounter.textContent = `Step ${currentIdx + 1} of ${activeCourse.lessons.length}`;

        prevLessonBtn.disabled = currentIdx === 0;
        prevLessonBtn.style.opacity = currentIdx === 0 ? '0.4' : '1';

        updateNextBtnLockState();

        const progress = window.UseasStore.getCourseProgress(activeCourse.id);
        updatePlayerProgressUI(progress);
        highlightActiveSidebarItem(lesson.id);
    }

    function updateNextBtnLockState() {
        if (!activeCourse || !activeLesson || !nextLessonBtn || !window.UseasStore) return;
        const currentIdx = activeCourse.lessons.findIndex(l => l.id === activeLesson.id);
        const hasNext = currentIdx >= 0 && currentIdx < activeCourse.lessons.length - 1;
        if (!hasNext) {
            nextLessonBtn.disabled = true;
            nextLessonBtn.style.opacity = '0.4';
            nextLessonBtn.innerHTML = `Next Video <i class="fa-solid fa-arrow-right"></i>`;
            return;
        }
        const progress = window.UseasStore.getCourseProgress(activeCourse.id);
        const currentCompleted = progress.completedLessons.includes(activeLesson.id);
        if (!currentCompleted) {
            nextLessonBtn.disabled = true;
            nextLessonBtn.style.opacity = '0.55';
            nextLessonBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Next Locked`;
        } else {
            nextLessonBtn.disabled = false;
            nextLessonBtn.style.opacity = '1';
            nextLessonBtn.innerHTML = `Next Video <i class="fa-solid fa-arrow-right"></i>`;
        }
    }

    function openPreExamModal() {
        const modal = document.getElementById('preExamModal');
        if (!modal) return;
        modal.classList.add('active');
        startWebcamPreview();
    }

    function startWebcamPreview() {
        const badge = document.getElementById('webcamStatusBadge');
        const feed = document.getElementById('preExamWebcamFeed');
        const fallback = document.getElementById('camFallbackMsg');

        if (badge) badge.textContent = 'Requesting camera access...';

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                .then(stream => {
                    activeWebcamStream = stream;
                    if (feed) {
                        feed.srcObject = stream;
                        feed.play();
                    }
                    if (badge) badge.innerHTML = `<span style="color: var(--accent-green);"><i class="fa-solid fa-circle"></i> Camera & Microphone Active</span>`;
                    if (fallback) fallback.style.display = 'none';
                })
                .catch(() => {
                    if (badge) badge.innerHTML = `<span style="color: var(--accent-red);"><i class="fa-solid fa-circle-exclamation"></i> Camera Access Denied</span>`;
                    if (fallback) fallback.style.display = 'block';
                });
        } else {
            if (badge) badge.textContent = 'Camera API not supported in browser';
        }
    }

    function stopWebcamPreview() {
        if (activeWebcamStream) {
            activeWebcamStream.getTracks().forEach(t => t.stop());
            activeWebcamStream = null;
        }
        const feed = document.getElementById('preExamWebcamFeed');
        if (feed) feed.srcObject = null;
    }

    const closePreExamModalBtn = document.getElementById('closePreExamModalBtn');
    const cancelPreExamBtn = document.getElementById('cancelPreExamBtn');
    const enableCamBtn = document.getElementById('enableCamBtn');
    const launchExamTabBtn = document.getElementById('launchExamTabBtn');

    if (closePreExamModalBtn) {
        closePreExamModalBtn.addEventListener('click', () => {
            stopWebcamPreview();
            document.getElementById('preExamModal').classList.remove('active');
        });
    }
    if (cancelPreExamBtn) {
        cancelPreExamBtn.addEventListener('click', () => {
            stopWebcamPreview();
            document.getElementById('preExamModal').classList.remove('active');
        });
    }
    if (enableCamBtn) {
        enableCamBtn.addEventListener('click', startWebcamPreview);
    }

    if (launchExamTabBtn) {
        launchExamTabBtn.addEventListener('click', () => {
            if (!activeCourse || !activeLesson) return;
            stopWebcamPreview();
            document.getElementById('preExamModal').classList.remove('active');

            const examUrl = `exam.html?courseId=${encodeURIComponent(activeCourse.id)}&lessonId=${encodeURIComponent(activeLesson.id)}`;
            window.open(examUrl, '_blank');
            showToast('🚀 Exam launched in secure window!', 'success');
        });
    }

    window.addEventListener('progress-updated', () => {
        if (activeCourse && activeLesson && window.UseasStore) {
            const progress = window.UseasStore.getCourseProgress(activeCourse.id);
            updatePlayerProgressUI(progress);
            renderLessonsPlaylist();
            loadLesson(activeLesson.id);
        }
    });

    function updatePlayerProgressUI(progress, liveRatio = 0) {
        if (!activeCourse || !activeLesson) return;

        let effectivePct = progress.percentage;
        if (progress.totalLessons > 0 && !progress.completedLessons.includes(activeLesson.id)) {
            const currentContrib = (liveRatio / progress.totalLessons) * 100;
            effectivePct = Math.min(100, Math.round(progress.percentage + currentContrib));
        }

        const isFullyComplete = effectivePct >= 100 || progress.percentage === 100;

        const modalProgressPct = document.getElementById('modalProgressPct');
        const modalProgressBarFill = document.getElementById('modalProgressBarFill');
        const sidebarProgressCount = document.getElementById('sidebarProgressCount');

        if (modalProgressPct) {
            if (isFullyComplete) {
                modalProgressPct.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 1.05rem; vertical-align: middle;"></i> <span style="color: #10b981; font-weight: 800;">100% Completed!</span>`;
            } else {
                modalProgressPct.textContent = `${effectivePct}%`;
                modalProgressPct.className = 'progress-pct';
            }
        }

        if (modalProgressBarFill) {
            modalProgressBarFill.style.width = `${effectivePct}%`;
            if (isFullyComplete) {
                modalProgressBarFill.classList.add('completed');
            } else {
                modalProgressBarFill.classList.remove('completed');
            }
        }

        if (sidebarProgressCount) {
            sidebarProgressCount.textContent = `${progress.completedCount} / ${progress.totalLessons} Lessons Completed`;
        }
    }

    function renderLessonsPlaylist() {
        if (!lessonsList || !activeCourse || !window.UseasStore) return;

        const progress = window.UseasStore.getCourseProgress(activeCourse.id);

        lessonsList.innerHTML = activeCourse.lessons.map((lesson, index) => {
            const isDone = progress.completedLessons.includes(lesson.id);
            const isActive = activeLesson && activeLesson.id === lesson.id;
            const isUnlocked = (index === 0) || progress.completedLessons.includes(activeCourse.lessons[index - 1].id);

            const type = lesson.type || 'video';
            let typeBadge = '';
            if (type === 'video') {
                typeBadge = `<span style="font-size:0.7rem; color:var(--accent-cyan); background:rgba(2,132,199,0.1); padding:1px 5px; border-radius:3px; margin-left:4px;"><i class="fa-solid fa-video"></i> Video</span>`;
            } else if (type === 'text') {
                typeBadge = `<span style="font-size:0.7rem; color:var(--accent-green); background:rgba(16,185,129,0.1); padding:1px 5px; border-radius:3px; margin-left:4px;"><i class="fa-solid fa-file-lines"></i> Article</span>`;
            } else if (type === 'test') {
                typeBadge = `<span style="font-size:0.7rem; color:var(--secondary); background:rgba(168,85,247,0.1); padding:1px 5px; border-radius:3px; margin-left:4px;"><i class="fa-solid fa-clipboard-check"></i> Test</span>`;
            }

            return `
                <li class="lesson-item ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''} ${!isUnlocked ? 'locked-step' : ''}" data-lesson-id="${lesson.id}" style="${!isUnlocked ? 'opacity: 0.65; cursor: not-allowed;' : ''}">
                    <div class="lesson-check">
                        ${!isUnlocked ? `<i class="fa-solid fa-lock" style="color: var(--accent-amber); font-size: 0.85rem;" title="Complete previous step to unlock"></i>` : `
                            <i class="fa-solid ${isDone ? 'fa-circle-check' : 'fa-play'}" style="${isDone ? 'color: #10b981; font-size: 1rem;' : 'font-size: 0.6rem;'}"></i>
                        `}
                    </div>
                    <div class="lesson-item-details">
                        <div class="lesson-item-title">${lesson.title} ${typeBadge}</div>
                        <div class="lesson-item-meta">
                            <i class="fa-regular fa-clock"></i> ${lesson.duration || '10 mins'}
                        </div>
                    </div>
                </li>
            `;
        }).join('');

        lessonsList.querySelectorAll('.lesson-item').forEach(item => {
            const lessonId = item.getAttribute('data-lesson-id');
            const index = activeCourse.lessons.findIndex(l => l.id === lessonId);
            const isUnlocked = (index === 0) || progress.completedLessons.includes(activeCourse.lessons[index - 1].id);

            item.addEventListener('click', () => {
                if (!isUnlocked) {
                    showToast('🔒 Step Locked! Complete the previous lesson or test first.', 'info');
                    return;
                }
                loadLesson(lessonId);
                renderLessonsPlaylist();
            });
        });

        const sidebarProgressCount = document.getElementById('sidebarProgressCount');
        if (sidebarProgressCount) {
            sidebarProgressCount.textContent = `${progress.completedCount} / ${progress.totalLessons} Lessons Completed`;
        }
    }

    function highlightActiveSidebarItem(lessonId) {
        if (!lessonsList) return;
        lessonsList.querySelectorAll('.lesson-item').forEach(item => {
            if (item.getAttribute('data-lesson-id') === lessonId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function navigateLesson(direction) {
        if (!activeCourse || !activeLesson || !window.UseasStore) return;
        const currentIdx = activeCourse.lessons.findIndex(l => l.id === activeLesson.id);
        const targetIdx = currentIdx + direction;

        if (targetIdx >= 0 && targetIdx < activeCourse.lessons.length) {
            if (direction > 0) {
                const progress = window.UseasStore.getCourseProgress(activeCourse.id);
                const isNextUnlocked = progress.completedLessons.includes(activeCourse.lessons[targetIdx - 1].id);
                if (!isNextUnlocked) {
                    showToast('🔒 Locked! Watch the full current video without skipping to unlock the next lesson.', 'warning');
                    return;
                }
            }
            loadLesson(activeCourse.lessons[targetIdx].id);
            renderLessonsPlaylist();
        }
    }

    function closePlayerModal() {
        stopLessonProctoringStreams();
        if (maskHideTimeout) {
            clearTimeout(maskHideTimeout);
            maskHideTimeout = null;
        }
        if (topBarShieldTimeout) {
            clearTimeout(topBarShieldTimeout);
            topBarShieldTimeout = null;
        }
        updateLiveAlertBanner(false);
        const videoContainerFs = document.getElementById('videoContainer');
        if (videoContainerFs && videoContainerFs.classList.contains('is-fullscreen')) {
            videoContainerFs.classList.remove('is-fullscreen');
            updateFullscreenBtnUI(false);
        }
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            try {
                const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
                if (exitFs) exitFs.call(document);
            } catch (e) {}
        }
        if (isPipActive) {
            isPipActive = false;
            const videoContainer = document.getElementById('videoContainer');
            const pipTitleBar = document.getElementById('pipTitleBar');
            const pipPlaceholder = document.getElementById('pipPlaceholderCard');
            if (videoContainer) videoContainer.classList.remove('pip-active');
            if (pipTitleBar) pipTitleBar.style.display = 'none';
            if (pipPlaceholder) pipPlaceholder.style.display = 'none';
        }
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && activeCourse && activeLesson && window.UseasStore) {
            try {
                const curr = ytPlayer.getCurrentTime() || 0;
                if (curr > 1) {
                    window.UseasStore.saveLessonTimestamp(activeCourse.id, activeLesson.id, curr);
                }
            } catch (e) {}
        }
        stopCustomTimeTracker();
        if (playerModal) {
            playerModal.classList.remove('active');
        }
        if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
            try { ytPlayer.stopVideo(); } catch (e) {}
        }
        ytPlayer = null;
        if (youtubeIframe) {
            youtubeIframe.src = '';
        }
        document.body.style.overflow = 'auto';
        renderCourses();
    }

    // Student Authentication UI Handlers
    function updateStudentHeaderUI() {
        const authOpenBtn = document.getElementById('authOpenBtn');
        const userHeaderProfile = document.getElementById('userHeaderProfile');
        const navAvatarLetter = document.getElementById('navAvatarLetter');
        const dropdownAvatarLetter = document.getElementById('dropdownAvatarLetter');
        const dropdownStudentName = document.getElementById('dropdownStudentName');
        const dropdownStudentEmail = document.getElementById('dropdownStudentEmail');
        const dropdownSucBadge = document.getElementById('dropdownSucBadge');
        const profileDropdown = document.getElementById('profileDropdown');

        const currentStudent = window.UseasStore ? window.UseasStore.getCurrentStudent() : null;

        if (currentStudent) {
            const firstName = currentStudent.fullName ? currentStudent.fullName.trim().split(' ')[0] : 'Student';
            const initial = firstName ? firstName.charAt(0).toUpperCase() : 'S';

            if (navAvatarLetter) navAvatarLetter.textContent = initial;
            if (dropdownAvatarLetter) dropdownAvatarLetter.textContent = initial;
            if (dropdownStudentName) dropdownStudentName.textContent = currentStudent.fullName || 'Student';
            if (dropdownStudentEmail) dropdownStudentEmail.textContent = currentStudent.email || '';
            if (dropdownSucBadge) dropdownSucBadge.textContent = currentStudent.sucCode || '';

            if (authOpenBtn) authOpenBtn.style.display = 'none';
            if (userHeaderProfile) userHeaderProfile.style.display = 'inline-block';
        } else {
            if (authOpenBtn) authOpenBtn.style.display = 'inline-flex';
            if (userHeaderProfile) userHeaderProfile.style.display = 'none';
            if (profileDropdown) profileDropdown.classList.remove('active');
        }
    }

    function setupAuthHandlers() {
        const authModal = document.getElementById('authModal');
        const authOpenBtn = document.getElementById('authOpenBtn');
        const closeAuthBtn = document.getElementById('closeAuthBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const profileAvatarBtn = document.getElementById('profileAvatarBtn');
        const profileDropdown = document.getElementById('profileDropdown');
        const userHeaderProfile = document.getElementById('userHeaderProfile');

        const tabLoginBtn = document.getElementById('tabLoginBtn');
        const tabSignupBtn = document.getElementById('tabSignupBtn');
        const authModalTitle = document.getElementById('authModalTitle');
        const authErrorBox = document.getElementById('authErrorBox');

        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        const abhyasFormContainer = document.getElementById('abhyasFormContainer');
        const authSwitchPrompt = document.getElementById('authSwitchPrompt');

        let abhyasCurrentStudent = null;
        let abhyasCurrentOtp = null;

        const abhyasSucForm = document.getElementById('abhyasSucForm');
        const abhyasSucInput = document.getElementById('abhyasSucInput');
        const abhyasSucSubmitBtn = document.getElementById('abhyasSucSubmitBtn');

        const abhyasDetailsCard = document.getElementById('abhyasDetailsCard');
        const displayAbhyasSuc = document.getElementById('displayAbhyasSuc');
        const displayAbhyasName = document.getElementById('displayAbhyasName');
        const displayAbhyasGroup = document.getElementById('displayAbhyasGroup');
        const abhyasBackBtn = document.getElementById('abhyasBackBtn');
        const abhyasConfirmBtn = document.getElementById('abhyasConfirmBtn');

        const abhyasOtpForm = document.getElementById('abhyasOtpForm');
        const abhyasOtpInput = document.getElementById('abhyasOtpInput');
        const otpEmailTarget = document.getElementById('otpEmailTarget');
        const abhyasResendOtpBtn = document.getElementById('abhyasResendOtpBtn');

        if (window.emailjs) {
            try {
                emailjs.init({ publicKey: "MJPLwD9idjGcD_L--" });
            } catch (e) {}
        }

        if (profileAvatarBtn && profileDropdown) {
            profileAvatarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActive = profileDropdown.classList.toggle('active');
                profileAvatarBtn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
            });
        }

        document.addEventListener('click', (e) => {
            if (profileDropdown && profileDropdown.classList.contains('active')) {
                if (userHeaderProfile && !userHeaderProfile.contains(e.target)) {
                    profileDropdown.classList.remove('active');
                    if (profileAvatarBtn) profileAvatarBtn.setAttribute('aria-expanded', 'false');
                }
            }
        });

        function openAuthModal(mode = 'login') {
            if (!authModal) return;
            authModal.classList.add('active');
            document.body.style.overflow = 'hidden';
            switchAuthTab(mode);
        }

        function closeAuthModal() {
            if (!authModal) return;
            authModal.classList.remove('active');
            document.body.style.overflow = 'auto';
            hideAuthError();
        }

        const authTabsContainer = document.querySelector('.auth-tabs');

        function switchAuthTab(mode) {
            hideAuthError();
            if (mode === 'signup') {
                if (authTabsContainer) authTabsContainer.style.display = 'flex';
                if (tabLoginBtn) tabLoginBtn.classList.remove('active');
                if (tabSignupBtn) tabSignupBtn.classList.add('active');

                if (loginForm) loginForm.style.display = 'none';
                if (signupForm) signupForm.style.display = 'flex';
                if (abhyasFormContainer) abhyasFormContainer.style.display = 'none';

                if (authModalTitle) authModalTitle.textContent = 'Create Student Account';
                if (authSwitchPrompt) {
                    authSwitchPrompt.innerHTML = `Already have an account? <a href="#" id="authSwitchLink" style="color: var(--primary-dark); font-weight: 700;">Log In here</a>`;
                    rebindSwitchLink();
                }
            } else if (mode === 'abhyas') {
                if (authTabsContainer) authTabsContainer.style.display = 'none';
                if (tabLoginBtn) tabLoginBtn.classList.remove('active');
                if (tabSignupBtn) tabSignupBtn.classList.remove('active');

                if (loginForm) loginForm.style.display = 'none';
                if (signupForm) signupForm.style.display = 'none';
                if (abhyasFormContainer) abhyasFormContainer.style.display = 'flex';

                if (abhyasSucForm) abhyasSucForm.style.display = 'flex';
                if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
                if (abhyasOtpForm) abhyasOtpForm.style.display = 'none';

                if (authModalTitle) authModalTitle.textContent = 'Abhyas Student Verification';
                if (authSwitchPrompt) {
                    authSwitchPrompt.innerHTML = `Want standard email login? <a href="#" id="authSwitchLink" style="color: var(--primary-dark); font-weight: 700;">Log In here</a>`;
                    rebindSwitchLink();
                }
            } else {
                if (authTabsContainer) authTabsContainer.style.display = 'flex';
                if (tabLoginBtn) tabLoginBtn.classList.add('active');
                if (tabSignupBtn) tabSignupBtn.classList.remove('active');

                if (loginForm) loginForm.style.display = 'flex';
                if (signupForm) signupForm.style.display = 'none';
                if (abhyasFormContainer) abhyasFormContainer.style.display = 'none';

                if (authModalTitle) authModalTitle.textContent = 'Student Portal Login';
                if (authSwitchPrompt) {
                    authSwitchPrompt.innerHTML = `Don't have an account? <a href="#" id="authSwitchLink" style="color: var(--primary-dark); font-weight: 700;">Sign Up here</a>`;
                    rebindSwitchLink();
                }
            }
        }

        function rebindSwitchLink() {
            const link = document.getElementById('authSwitchLink');
            if (link) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isSignup = signupForm && signupForm.style.display !== 'none';
                    switchAuthTab(isSignup ? 'login' : 'signup');
                });
            }
        }

        function showAuthError(msg) {
            if (authErrorBox) {
                authErrorBox.textContent = msg;
                authErrorBox.style.display = 'block';
            }
        }

        function hideAuthError() {
            if (authErrorBox) {
                authErrorBox.style.display = 'none';
                authErrorBox.textContent = '';
            }
        }

        if (authOpenBtn) authOpenBtn.addEventListener('click', () => openAuthModal('login'));
        if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);

        if (authModal) {
            authModal.addEventListener('click', (e) => {
                if (e.target === authModal) closeAuthModal();
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (profileDropdown) profileDropdown.classList.remove('active');
                if (window.UseasStore) window.UseasStore.logoutStudent();
                updateStudentHeaderUI();
                showToast('Logged out of student account.', 'info');
            });
        }

        if (tabLoginBtn) tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
        if (tabSignupBtn) tabSignupBtn.addEventListener('click', () => switchAuthTab('signup'));

        document.querySelectorAll('.abhyasTriggerBtn').forEach(btn => {
            btn.addEventListener('click', () => switchAuthTab('abhyas'));
        });

        rebindSwitchLink();

        // ABHYAS FLOW HANDLERS
        let abhyasLottieAnim = null;

        function playEmailSentAnimation() {
            const container = document.getElementById('emailSentAnimContainer');
            if (!container) return;
            container.innerHTML = '';
            if (abhyasLottieAnim) {
                try { abhyasLottieAnim.destroy(); } catch(e){}
            }
            try {
                if (window.lottie) {
                    abhyasLottieAnim = window.lottie.loadAnimation({
                        container: container,
                        renderer: 'svg',
                        loop: true,
                        autoplay: true,
                        path: 'animations/Email successfully sent.json'
                    });
                }
            } catch (e) {}
        }

        if (abhyasSucForm) {
            abhyasSucForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                hideAuthError();

                const sucCode = abhyasSucInput.value.trim();
                if (!/^\d{10}$/.test(sucCode)) {
                    showAuthError('Please enter a valid 10-digit numeric Abhyas SUC code.');
                    return;
                }

                if (abhyasSucSubmitBtn) {
                    abhyasSucSubmitBtn.disabled = true;
                    abhyasSucSubmitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching Student Details...`;
                }

                try {
                    const response = await fetch(`https://student-api.mentalprasad2001.workers.dev/?id=${encodeURIComponent(sucCode)}`);
                    const json = await response.json();

                    if (json.status === 'success' && json.data) {
                        const sData = json.data;
                        const normSuc = sucCode.toUpperCase();
                        const normEmail = (sData.email || `${sucCode}@abhyas.edu.in`).trim().toLowerCase();

                        const existingStudent = window.UseasStore ? window.UseasStore.getStudentBySucOrEmail(normSuc, normEmail) : null;

                        abhyasCurrentStudent = {
                            sucCode: normSuc,
                            name: sData.name || sData.fullName || 'Abhyas Student',
                            email: existingStudent ? existingStudent.email : normEmail,
                            group: sData.group || sData.course || 'Abhyas Course',
                            hasPassword: !!(existingStudent && existingStudent.password)
                        };

                        if (displayAbhyasSuc) displayAbhyasSuc.textContent = abhyasCurrentStudent.sucCode;
                        if (displayAbhyasName) displayAbhyasName.textContent = abhyasCurrentStudent.name;
                        if (displayAbhyasGroup) displayAbhyasGroup.textContent = abhyasCurrentStudent.group;

                        const firstTimeBox = document.getElementById('abhyasFirstTimeBox');
                        const subsequentBox = document.getElementById('abhyasSubsequentBox');
                        const emailInput = document.getElementById('abhyasEmailInput');
                        const emailInputSubsequent = document.getElementById('abhyasEmailInputSubsequent');

                        if (emailInput) emailInput.value = abhyasCurrentStudent.email;
                        if (emailInputSubsequent) emailInputSubsequent.value = abhyasCurrentStudent.email;

                        if (abhyasCurrentStudent.hasPassword) {
                            if (firstTimeBox) firstTimeBox.style.display = 'none';
                            if (subsequentBox) subsequentBox.style.display = 'flex';
                            switchAbhyasSubsequentTab('password');
                        } else {
                            if (firstTimeBox) firstTimeBox.style.display = 'flex';
                            if (subsequentBox) subsequentBox.style.display = 'none';
                        }

                        abhyasSucForm.style.display = 'none';
                        if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'flex';
                    } else {
                        showAuthError(json.message || `No student records found for SUC Code: ${sucCode}. Please check your code.`);
                    }
                } catch (err) {
                    showAuthError('Unable to connect to Abhyas server. Please check your internet connection.');
                } finally {
                    if (abhyasSucSubmitBtn) {
                        abhyasSucSubmitBtn.disabled = false;
                        abhyasSucSubmitBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Submit & Fetch Details`;
                    }
                }
            });
        }

        const abhyasMethodPassBtn = document.getElementById('abhyasMethodPassBtn');
        const abhyasMethodOtpBtn = document.getElementById('abhyasMethodOtpBtn');
        const abhyasPasswordForm = document.getElementById('abhyasPasswordForm');
        const abhyasOtpOptionBox = document.getElementById('abhyasOtpOptionBox');

        function switchAbhyasSubsequentTab(method) {
            hideAuthError();
            if (method === 'otp') {
                if (abhyasMethodPassBtn) {
                    abhyasMethodPassBtn.classList.remove('active');
                    abhyasMethodPassBtn.style.background = 'transparent';
                    abhyasMethodPassBtn.style.color = '#475569';
                }
                if (abhyasMethodOtpBtn) {
                    abhyasMethodOtpBtn.classList.add('active');
                    abhyasMethodOtpBtn.style.background = '#ffffff';
                    abhyasMethodOtpBtn.style.color = '#1e293b';
                }
                if (abhyasPasswordForm) abhyasPasswordForm.style.display = 'none';
                if (abhyasOtpOptionBox) abhyasOtpOptionBox.style.display = 'flex';
            } else {
                if (abhyasMethodPassBtn) {
                    abhyasMethodPassBtn.classList.add('active');
                    abhyasMethodPassBtn.style.background = '#ffffff';
                    abhyasMethodPassBtn.style.color = '#1e293b';
                }
                if (abhyasMethodOtpBtn) {
                    abhyasMethodOtpBtn.classList.remove('active');
                    abhyasMethodOtpBtn.style.background = 'transparent';
                    abhyasMethodOtpBtn.style.color = '#475569';
                }
                if (abhyasPasswordForm) abhyasPasswordForm.style.display = 'flex';
                if (abhyasOtpOptionBox) abhyasOtpOptionBox.style.display = 'none';
            }
        }

        if (abhyasMethodPassBtn) abhyasMethodPassBtn.addEventListener('click', () => switchAbhyasSubsequentTab('password'));
        if (abhyasMethodOtpBtn) abhyasMethodOtpBtn.addEventListener('click', () => switchAbhyasSubsequentTab('otp'));

        if (abhyasPasswordForm) {
            abhyasPasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                hideAuthError();

                const enteredPass = document.getElementById('abhyasPasswordInput').value;
                if (!enteredPass) {
                    showAuthError('Please enter your account password.');
                    return;
                }

                const student = window.UseasStore ? window.UseasStore.getStudentBySucOrEmail(abhyasCurrentStudent.sucCode, abhyasCurrentStudent.email) : null;
                if (student && student.password === enteredPass) {
                    window.UseasStore.loginOrRegisterAbhyasStudent({
                        name: abhyasCurrentStudent.name,
                        email: abhyasCurrentStudent.email,
                        group: abhyasCurrentStudent.group,
                        sucCode: abhyasCurrentStudent.sucCode,
                        password: student.password
                    });
                    closeAuthModal();
                    abhyasSucInput.value = '';
                    document.getElementById('abhyasPasswordInput').value = '';
                    updateStudentHeaderUI();
                    showToast(`🎉 Welcome back, ${abhyasCurrentStudent.name}! Logged in successfully.`, 'success');
                } else {
                    showAuthError('Incorrect password. Please check your password or log in via Email OTP.');
                }
            });
        }

        const resetToStep1 = () => {
            hideAuthError();
            if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
            if (abhyasSucForm) abhyasSucForm.style.display = 'flex';
        };

        if (abhyasBackBtn) abhyasBackBtn.addEventListener('click', resetToStep1);
        const abhyasSubsequentBackBtn = document.getElementById('abhyasSubsequentBackBtn');
        const abhyasSubsequentBackBtn2 = document.getElementById('abhyasSubsequentBackBtn2');
        if (abhyasSubsequentBackBtn) abhyasSubsequentBackBtn.addEventListener('click', resetToStep1);
        if (abhyasSubsequentBackBtn2) abhyasSubsequentBackBtn2.addEventListener('click', resetToStep1);

        let abhyasOtpTimer = null;
        let abhyasResendCountdown = 0;

        function startResendCountdown(seconds) {
            if (abhyasOtpTimer) clearInterval(abhyasOtpTimer);
            abhyasResendCountdown = seconds;

            if (!abhyasResendOtpBtn) return;
            abhyasResendOtpBtn.disabled = true;

            abhyasOtpTimer = setInterval(() => {
                abhyasResendCountdown--;
                if (abhyasResendCountdown <= 0) {
                    clearInterval(abhyasOtpTimer);
                    abhyasResendOtpBtn.disabled = false;
                    abhyasResendOtpBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Resend OTP`;
                } else {
                    abhyasResendOtpBtn.innerHTML = `<i class="fa-solid fa-clock"></i> Resend (${abhyasResendCountdown}s)`;
                }
            }, 1000);
        }

        function sendAbhyasOtp(useSubsequentEmail = false) {
            if (!abhyasCurrentStudent) return;
            hideAuthError();

            const emailInput = document.getElementById(useSubsequentEmail ? 'abhyasEmailInputSubsequent' : 'abhyasEmailInput');
            let targetEmail = (emailInput ? emailInput.value : '').trim().toLowerCase();

            if (!targetEmail || !targetEmail.includes('@')) {
                showAuthError('Please enter a valid email address to receive your OTP code.');
                return;
            }

            abhyasCurrentStudent.email = targetEmail;
            abhyasCurrentOtp = Math.floor(100000 + Math.random() * 900000).toString();

            const confirmBtn = useSubsequentEmail ? document.getElementById('abhyasConfirmBtnSubsequent') : abhyasConfirmBtn;
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...`;
            }
            if (abhyasResendOtpBtn) {
                abhyasResendOtpBtn.disabled = true;
            }

            const templateParams = {
                email: targetEmail,
                to_email: targetEmail,
                user_email: targetEmail,
                reply_to: targetEmail,
                to_name: abhyasCurrentStudent.name || 'Abhyas Student',
                name: abhyasCurrentStudent.name || 'Abhyas Student',
                user_name: abhyasCurrentStudent.name || 'Abhyas Student',
                otp: abhyasCurrentOtp,
                otp_code: abhyasCurrentOtp,
                passcode: abhyasCurrentOtp,
                code: abhyasCurrentOtp,
                message: `Your Abhyas verification OTP code is: ${abhyasCurrentOtp}`,
                suc_code: abhyasCurrentStudent.sucCode,
                course_name: abhyasCurrentStudent.group
            };

            const sendPromise = new Promise((resolve) => {
                let isSent = false;

                fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: 'useas_otpsender',
                        template_id: 'template_5weozdp',
                        user_id: 'MJPLwD9idjGcD_L--',
                        template_params: templateParams
                    })
                })
                .then(res => {
                    if (res.ok) {
                        isSent = true;
                        showToast(`✉️ OTP sent successfully to ${targetEmail}! Check your inbox.`, 'success');
                        resolve(true);
                    } else {
                        return res.text().then(text => Promise.reject(new Error(text)));
                    }
                })
                .catch(() => {
                    if (window.emailjs && !isSent) {
                        try {
                            if (window.emailjs.init) window.emailjs.init({ publicKey: 'MJPLwD9idjGcD_L--' });
                        } catch(e) {}

                        window.emailjs.send('useas_otpsender', 'template_5weozdp', templateParams, 'MJPLwD9idjGcD_L--')
                        .then(() => {
                            isSent = true;
                            showToast(`✉️ OTP sent successfully to ${targetEmail}! Check your inbox.`, 'success');
                            resolve(true);
                        })
                        .catch(() => {
                            showToast(`✉️ OTP sent to ${targetEmail}! Check your inbox.`, 'info');
                            resolve(false);
                        });
                    } else {
                        showToast(`✉️ OTP sent to ${targetEmail}! Check your inbox.`, 'info');
                        resolve(false);
                    }
                });
            });

            sendPromise.then(() => {
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> ${useSubsequentEmail ? 'Send OTP to Email' : 'Confirm & Send OTP'}`;
                }

                if (otpEmailTarget) otpEmailTarget.textContent = targetEmail;

                if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
                if (abhyasOtpForm) abhyasOtpForm.style.display = 'flex';

                playEmailSentAnimation();

                if (abhyasOtpInput) abhyasOtpInput.focus();

                startResendCountdown(30);
            });
        }

        if (abhyasConfirmBtn) {
            abhyasConfirmBtn.addEventListener('click', () => sendAbhyasOtp(false));
        }

        const abhyasConfirmBtnSubsequent = document.getElementById('abhyasConfirmBtnSubsequent');
        if (abhyasConfirmBtnSubsequent) {
            abhyasConfirmBtnSubsequent.addEventListener('click', () => sendAbhyasOtp(true));
        }

        if (abhyasResendOtpBtn) {
            abhyasResendOtpBtn.addEventListener('click', () => {
                sendAbhyasOtp(false);
            });
        }

        if (abhyasOtpForm) {
            abhyasOtpForm.addEventListener('submit', (e) => {
                e.preventDefault();
                hideAuthError();

                const enteredOtp = abhyasOtpInput.value.trim();
                if (!enteredOtp) {
                    showAuthError('Please enter the 6-digit OTP sent to your email.');
                    return;
                }

                if (enteredOtp !== abhyasCurrentOtp) {
                    showAuthError('Invalid OTP code. Please check your email inbox and try again.');
                    return;
                }

                if (abhyasCurrentStudent.hasPassword) {
                    const res = window.UseasStore.loginOrRegisterAbhyasStudent(abhyasCurrentStudent);
                    if (res.error) {
                        showAuthError(res.error);
                    } else {
                        closeAuthModal();
                        abhyasSucInput.value = '';
                        abhyasOtpInput.value = '';
                        updateStudentHeaderUI();
                        showToast(`🎉 Welcome back, ${abhyasCurrentStudent.name}! Logged in via Abhyas.`, 'success');
                    }
                } else {
                    if (abhyasOtpForm) abhyasOtpForm.style.display = 'none';
                    const setPassForm = document.getElementById('abhyasSetPasswordForm');
                    if (setPassForm) setPassForm.style.display = 'flex';
                    const newPassInput = document.getElementById('abhyasNewPasswordInput');
                    if (newPassInput) newPassInput.focus();
                }
            });
        }

        const abhyasSetPasswordForm = document.getElementById('abhyasSetPasswordForm');
        if (abhyasSetPasswordForm) {
            abhyasSetPasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                hideAuthError();

                const newPass = document.getElementById('abhyasNewPasswordInput').value;
                const confirmPass = document.getElementById('abhyasConfirmPasswordInput').value;

                if (!newPass || newPass.length < 4) {
                    showAuthError('Password must be at least 4 characters long.');
                    return;
                }

                if (newPass !== confirmPass) {
                    showAuthError('Passwords do not match. Please check and re-enter.');
                    return;
                }

                const res = window.UseasStore.loginOrRegisterAbhyasStudent({
                    name: abhyasCurrentStudent.name,
                    email: abhyasCurrentStudent.email,
                    group: abhyasCurrentStudent.group,
                    sucCode: abhyasCurrentStudent.sucCode,
                    password: newPass
                });

                if (res.error) {
                    showAuthError(res.error);
                } else {
                    closeAuthModal();
                    abhyasSucInput.value = '';
                    abhyasOtpInput.value = '';
                    document.getElementById('abhyasNewPasswordInput').value = '';
                    document.getElementById('abhyasConfirmPasswordInput').value = '';
                    updateStudentHeaderUI();
                    showToast(`🎉 Password set successfully! Welcome, ${abhyasCurrentStudent.name}!`, 'success');
                }
            });
        }

        if (signupForm) {
            signupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                hideAuthError();

                const fullName = document.getElementById('signupNameInput').value.trim();
                const sucCode = document.getElementById('signupSucInput').value.trim();
                const email = document.getElementById('signupEmailInput').value.trim();
                const password = document.getElementById('signupPasswordInput').value;
                const confirmPassword = document.getElementById('signupConfirmPasswordInput').value;

                if (!fullName || !sucCode || !email || !password || !confirmPassword) {
                    showAuthError('Please fill in all student information fields.');
                    return;
                }

                if (password !== confirmPassword) {
                    showAuthError('Passwords do not match! Please check and re-enter both passwords.');
                    return;
                }

                const res = window.UseasStore.registerStudent({ fullName, sucCode, email, password });
                if (res.error) {
                    showAuthError(res.error);
                } else {
                    closeAuthModal();
                    signupForm.reset();
                    updateStudentHeaderUI();
                    showToast(`🎉 Welcome, ${res.student.fullName}! Your account is created & logged in.`, 'success');
                }
            });
        }

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                hideAuthError();

                const identifier = document.getElementById('loginIdInput').value.trim();
                const password = document.getElementById('loginPasswordInput').value;

                if (!identifier || !password) {
                    showAuthError('Please enter your SUC Code or Email and password.');
                    return;
                }

                const res = window.UseasStore.loginStudent(identifier, password);
                if (res.error) {
                    showAuthError(res.error);
                } else {
                    closeAuthModal();
                    loginForm.reset();
                    updateStudentHeaderUI();
                    showToast(`🎉 Welcome back, ${res.student.fullName}!`, 'success');
                }
            });
        }
    }

    const navExploreCourses = document.getElementById('navExploreCourses');
    const navTopCourses = document.getElementById('navTopCourses');

    function setActiveNavPill(activeElem) {
        if (navExploreCourses) navExploreCourses.classList.remove('active');
        if (navTopCourses) navTopCourses.classList.remove('active');
        if (activeElem) activeElem.classList.add('active');
    }

    if (navExploreCourses) {
        navExploreCourses.addEventListener('click', (e) => {
            e.preventDefault();
            setActiveNavPill(navExploreCourses);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (navTopCourses) {
        navTopCourses.addEventListener('click', (e) => {
            e.preventDefault();
            setActiveNavPill(navTopCourses);
            const coursesSec = document.getElementById('coursesGrid') || document.querySelector('.courses-section');
            if (coursesSec) {
                coursesSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    window.addEventListener('scroll', () => {
        const coursesSec = document.getElementById('coursesGrid');
        if (!coursesSec) return;
        const rect = coursesSec.getBoundingClientRect();
        if (rect.top <= 250) {
            setActiveNavPill(navTopCourses);
        } else {
            setActiveNavPill(navExploreCourses);
        }
    }, { passive: true });
});
