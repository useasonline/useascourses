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

    // Window postMessage listener for YouTube Player Iframe
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
                    latestYtPlayerState = info.playerState;
                    if (info.playerState === 1) {
                        isCurrentlyPlaying = true;
                        updatePlayPauseUI(true);
                    } else if (info.playerState === 2 || info.playerState === 0) {
                        isCurrentlyPlaying = false;
                        updatePlayPauseUI(false);
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

    function togglePlayPause() {
        const state = getYTPlayerState();
        const playing = (state === 1) || isCurrentlyPlaying;
        if (playing) {
            isCurrentlyPlaying = false;
            sendYTCommand('pauseVideo');
            showPlayPauseAnim('pause');
            updatePlayPauseUI(false);
        } else {
            isCurrentlyPlaying = true;
            sendYTCommand('playVideo');
            showPlayPauseAnim('play');
            updatePlayPauseUI(true);
        }
    }

    function rewind10Seconds() {
        const curr = getYTCurrentTime();
        const newTime = Math.max(0, curr - 10);
        latestYtCurrentTime = newTime;
        sendYTCommand('seekTo', [newTime, true]);
        showToast('⏪ Rewound 10 seconds', 'info');
    }

    function forward10Seconds() {
        const curr = getYTCurrentTime();
        const dur = getYTDuration();
        const targetSec = curr + 10;
        if (targetSec > maxWatchedTime + 2 && dur > 0) {
            showToast('⚠️ Fast-forwarding disabled! Please watch in sequence.', 'info');
            return;
        }
        const newTime = Math.min(dur > 0 ? dur : 9999, targetSec);
        latestYtCurrentTime = newTime;
        sendYTCommand('seekTo', [newTime, true]);
        showToast('⏩ Forwarded 10 seconds', 'info');
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

    function toggleFullscreen() {
        const container = document.getElementById('videoContainer') || document.getElementById('videoWrapper');
        const icon = document.getElementById('fullscreenIcon');
        if (!container) return;

        const fsElem = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        if (!fsElem) {
            const reqFs = container.requestFullscreen || container.webkitRequestFullscreen || container.msRequestFullscreen;
            if (reqFs) {
                reqFs.call(container).then(() => {
                    if (icon) icon.className = 'fa-solid fa-compress';
                }).catch(() => {});
            }
        } else {
            const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
            if (exitFs) {
                exitFs.call(document).then(() => {
                    if (icon) icon.className = 'fa-solid fa-expand';
                }).catch(() => {});
            }
        }
    }

    document.addEventListener('fullscreenchange', () => {
        const icon = document.getElementById('fullscreenIcon');
        if (icon) {
            icon.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        }
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

    function updateCustomBarUI(curr, dur) {
        const state = getYTPlayerState();
        if (state === 1) {
            maxWatchedTime = Math.max(maxWatchedTime, curr);
            if (curr > 1 && activeCourse && activeLesson && window.UseasStore) {
                window.UseasStore.saveLessonTimestamp(activeCourse.id, activeLesson.id, curr);
            }
        }

        if (pendingResumeTimestamp > 2 && dur > 0) {
            const resumeTime = pendingResumeTimestamp;
            pendingResumeTimestamp = 0;
            latestYtCurrentTime = resumeTime;
            sendYTCommand('seekTo', [resumeTime, true]);
            const pct = Math.round((resumeTime / dur) * 100);
            showToast(`▶ Resumed playback from ${formatTime(resumeTime)} (${pct}%)`, 'info');
        }

        const timeDisplay = document.getElementById('customTimeDisplay');
        const scrubSlider = document.getElementById('customScrubSlider');
        const scrubFill = document.getElementById('customScrubFill');
        const playIcon = document.getElementById('customPlayIcon');

        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(curr)} / ${formatTime(dur)}`;
        }

        if (dur > 0 && scrubSlider && scrubFill && !isScrubbing) {
            const pct = (curr / dur) * 100;
            scrubSlider.value = pct;
            scrubFill.style.width = `${pct}%`;
        }

        if (playIcon) {
            playIcon.className = state === 1 ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }

        if (dur > 0 && activeCourse && activeLesson && window.UseasStore) {
            const liveRatio = Math.min(1.0, curr / dur);
            const progress = window.UseasStore.getCourseProgress(activeCourse.id);
            
            if (liveRatio >= 0.98 && !progress.completedLessons.includes(activeLesson.id)) {
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
                updatePlayerProgressUI(newProgress, 1.0);
                renderLessonsPlaylist();
                renderCourses();
                showToast('🎉 Course video 100% completed!', 'success');
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
                        videoId: videoId || undefined,
                        playerVars: {
                            'autoplay': 1,
                            'controls': 0,
                            'rel': 0,
                            'modestbranding': 1,
                            'disablekb': 1,
                            'iv_load_policy': 3,
                            'fs': 0,
                            'enablejsapi': 1
                        },
                        events: {
                            'onStateChange': onPlayerStateChange,
                            'onError': onPlayerError
                        }
                    });
                }
            }
        } catch (e) {
            console.log('YouTube API init notice:', e);
        }
    }

    function onPlayerError(event) {
        console.warn('YouTube Player notice/error code:', event ? event.data : 'unknown');
        hasPlayerError = true;
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

    function onPlayerStateChange(event) {
        if (event && typeof event.data === 'number') {
            if (event.data === 1) {
                isCurrentlyPlaying = true;
                updatePlayPauseUI(true);
                handleMouseMoveControls();
            } else if (event.data === 2 || event.data === 0) {
                isCurrentlyPlaying = false;
                updatePlayPauseUI(false);
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
            if (activeCourse && activeLesson && window.UseasStore) {
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
                updatePlayerProgressUI(newProgress);
                renderLessonsPlaylist();
                renderCourses();
                showToast('🎉 Lesson video completed! Progress updated.', 'success');
            }
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
        const customForward10Btn = document.getElementById('customForward10Btn');
        const customScrubSlider = document.getElementById('customScrubSlider');

        if (customPlayPauseBtn) customPlayPauseBtn.addEventListener('click', () => togglePlayPause());
        if (customRewind10Btn) customRewind10Btn.addEventListener('click', () => rewind10Seconds());
        if (customForward10Btn) customForward10Btn.addEventListener('click', () => forward10Seconds());

        const customMuteBtn = document.getElementById('customMuteBtn');
        const customVolumeSlider = document.getElementById('customVolumeSlider');

        if (customMuteBtn) customMuteBtn.addEventListener('click', () => toggleMute());
        if (customVolumeSlider) {
            customVolumeSlider.addEventListener('input', (e) => {
                handleVolumeChange(parseFloat(e.target.value));
            });
        }

        const speedMenuBtn = document.getElementById('speedMenuBtn');
        const speedSettingsBtn = document.getElementById('speedSettingsBtn');
        const speedMenuDropdown = document.getElementById('speedMenuDropdown');

        if (speedMenuBtn) {
            speedMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSpeedMenu();
            });
        }
        if (speedSettingsBtn) {
            speedSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSpeedMenu();
            });
        }
        if (speedMenuDropdown) {
            speedMenuDropdown.querySelectorAll('.speed-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const spd = parseFloat(opt.getAttribute('data-speed'));
                    setPlaybackSpeed(spd);
                });
            });
        }

        const pipBtn = document.getElementById('pipBtn');
        const exitPipBtn = document.getElementById('exitPipBtn');
        const pipReturnBtn = document.getElementById('pipReturnBtn');

        if (pipBtn) pipBtn.addEventListener('click', () => togglePip());
        if (exitPipBtn) exitPipBtn.addEventListener('click', () => togglePip());
        if (pipReturnBtn) pipReturnBtn.addEventListener('click', () => togglePip());

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

            customScrubSlider.addEventListener('input', (e) => {
                const pct = parseFloat(e.target.value);
                const dur = getYTDuration();
                if (dur > 0) {
                    const targetSec = (pct / 100) * dur;
                    if (targetSec > maxWatchedTime + 2) {
                        const safePct = (maxWatchedTime / dur) * 100;
                        e.target.value = safePct;
                        const fill = document.getElementById('customScrubFill');
                        if (fill) fill.style.width = `${safePct}%`;
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

                    if (targetSec > maxWatchedTime + 2) {
                        const safeTime = Math.max(0, maxWatchedTime);
                        latestYtCurrentTime = safeTime;
                        sendYTCommand('seekTo', [safeTime, true]);

                        const safePct = (dur > 0) ? (safeTime / dur) * 100 : 0;
                        customScrubSlider.value = safePct;
                        const fill = document.getElementById('customScrubFill');
                        if (fill) fill.style.width = `${safePct}%`;

                        showToast('⚠️ Fast-forwarding disabled! Please watch in sequence.', 'info');
                    } else {
                        latestYtCurrentTime = targetSec;
                        sendYTCommand('seekTo', [targetSec, true]);
                    }
                }
            };

            customScrubSlider.addEventListener('mouseup', commitSeek);
            customScrubSlider.addEventListener('touchend', commitSeek);
            customScrubSlider.addEventListener('change', commitSeek);
        }

        document.addEventListener('keydown', (e) => {
            const tag = e.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

            if (playerModal && playerModal.classList.contains('active')) {
                if (e.code === 'Space' || e.key === ' ' || e.key === 'k' || e.key === 'K') {
                    e.preventDefault();
                    togglePlayPause();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    rewind10Seconds();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    forward10Seconds();
                } else if (e.key === 'm' || e.key === 'M') {
                    e.preventDefault();
                    toggleMute();
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    toggleFullscreen();
                } else if (e.key === 'p' || e.key === 'P') {
                    e.preventDefault();
                    togglePip();
                } else if (e.key === 'Escape') {
                    if (document.fullscreenElement) return;
                    if (isPipActive) {
                        togglePip();
                    } else {
                        closePlayerModal();
                    }
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
        
        const foundLesson = course.lessons.find(l => l.id === startLessonId);
        activeLesson = foundLesson || course.lessons[0];

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

        stopCustomTimeTracker();

        if (type === 'video') {
            hasPlayerError = false;
            const fallbackCard = document.getElementById('restrictedFallbackCard');
            const controlsBar = document.getElementById('customVideoControlsBar');
            const bigCenterBtn = document.getElementById('bigCenterPlayBtn');
            if (fallbackCard) fallbackCard.style.display = 'none';
            if (controlsBar) controlsBar.style.display = 'flex';
            if (bigCenterBtn) bigCenterBtn.style.display = 'flex';

            if (videoContainer) videoContainer.style.display = 'flex';
            if (videoWrap) videoWrap.style.display = 'block';
            if (textView) textView.style.display = 'none';
            if (testView) testView.style.display = 'none';

            const savedTimestamp = window.UseasStore.getLessonTimestamp(activeCourse.id, lesson.id);
            const currentProgress = window.UseasStore.getCourseProgress(activeCourse.id);
            const isLessonDone = currentProgress.completedLessons.includes(lesson.id);
            maxWatchedTime = isLessonDone ? 999999 : (savedTimestamp || 0);

            pendingResumeTimestamp = (!isLessonDone && savedTimestamp > 2) ? savedTimestamp : 0;
            const startParam = pendingResumeTimestamp > 2 ? `&start=${Math.floor(pendingResumeTimestamp)}` : '';

            const videoId = lesson.videoId || window.UseasStore.extractYoutubeId(lesson.videoUrl);
            currentVideoId = videoId;
            const isHttp = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && window.location.origin && window.location.origin !== 'null';
            const originParam = isHttp ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&controls=0&rel=0&modestbranding=1&disablekb=1&iv_load_policy=3&fs=0${startParam}${originParam}`;

            if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                try {
                    if (pendingResumeTimestamp > 2) {
                        ytPlayer.loadVideoById({ videoId: videoId, startSeconds: Math.floor(pendingResumeTimestamp) });
                    } else {
                        ytPlayer.loadVideoById(videoId);
                    }
                } catch (e) {
                    if (youtubeIframe) youtubeIframe.src = embedUrl;
                }
            } else {
                if (youtubeIframe) youtubeIframe.src = embedUrl;
                initYTPlayer(videoId);
            }

            startCustomTimeTracker();
        } else if (type === 'text') {
            if (videoContainer) videoContainer.style.display = 'none';
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
                    showToast('🎉 Article reading completed!', 'success');
                    navigateLesson(1);
                };
            }
        } else if (type === 'test') {
            if (videoContainer) videoContainer.style.display = 'none';
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

        nextLessonBtn.disabled = currentIdx === activeCourse.lessons.length - 1;
        nextLessonBtn.style.opacity = currentIdx === activeCourse.lessons.length - 1 ? '0.4' : '1';

        const progress = window.UseasStore.getCourseProgress(activeCourse.id);
        updatePlayerProgressUI(progress);
        highlightActiveSidebarItem(lesson.id);
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
        if (!activeCourse || !activeLesson) return;
        const currentIdx = activeCourse.lessons.findIndex(l => l.id === activeLesson.id);
        const targetIdx = currentIdx + direction;

        if (targetIdx >= 0 && targetIdx < activeCourse.lessons.length) {
            loadLesson(activeCourse.lessons[targetIdx].id);
            renderLessonsPlaylist();
        }
    }

    function closePlayerModal() {
        if (document.fullscreenElement) {
            try { document.exitFullscreen(); } catch (e) {}
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
