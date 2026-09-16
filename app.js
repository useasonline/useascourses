/**
 * useas - User Portal Application Script (app.js)
 * Handles course catalog rendering, category filtering, search, YouTube player modal, & progress tracking.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
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
    const toggleCompleteBtn = document.getElementById('toggleCompleteBtn');

    // App State
    let activeCategory = 'all';
    let searchQuery = '';
    let activeCourse = null;
    let activeLesson = null;
    let ytPlayer = null;
    let playerTimeInterval = null;
    let isScrubbing = false;
    let maxWatchedTime = 0; // Tracks furthest watched timestamp to prevent fast-forwarding
    let pendingResumeTimestamp = 0;
    let noItemAnimData = null;
    let activeNoItemAnim = null;
    let lockedAnimData = null;
    let activeLockedAnim = null;

    // Pre-fetch Lottie No Item Animation JSON
    fetch('animations/no-item-found.json')
        .then(res => res.json())
        .then(data => {
            noItemAnimData = data;
            // If empty state is currently visible, render immediately
            if (document.getElementById('lottieNoItemWrap') && !activeNoItemAnim && window.lottie) {
                renderCourses();
            }
        })
        .catch(err => console.log('Lottie prefetch notice:', err));

    // Pre-fetch Lottie Locked Animation JSON
    fetch('animations/locked.json')
        .then(res => res.json())
        .then(data => { lockedAnimData = data; })
        .catch(err => console.log('Locked lottie prefetch notice:', err));

    let latestYtCurrentTime = 0;
    let latestYtDuration = 0;
    let latestYtPlayerState = -1;
    let isCurrentlyPlaying = false;

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
                    if (info.playerState === 1) { // PLAYING
                        isCurrentlyPlaying = true;
                        updatePlayPauseUI(true);
                    } else if (info.playerState === 2 || info.playerState === 0) { // PAUSED or ENDED
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
        if (playIcon) {
            playIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
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

    // Custom Player Time Tracking
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
        if (state === 1) { // 1 = PLAYING
            maxWatchedTime = Math.max(maxWatchedTime, curr);
            if (curr > 1 && activeCourse && activeLesson) {
                window.UseasStore.saveLessonTimestamp(activeCourse.id, activeLesson.id, curr);
            }
        }

        // Trigger pending resume seek if requested
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
            if (state === 1) { // PLAYING
                playIcon.className = 'fa-solid fa-pause';
            } else {
                playIcon.className = 'fa-solid fa-play';
            }
        }

        // Live Real-Time Course Completion Progress Update
        if (dur > 0 && activeCourse && activeLesson) {
            const liveRatio = Math.min(1.0, curr / dur);
            const progress = window.UseasStore.getCourseProgress(activeCourse.id);
            
            // Auto-complete lesson if user watches to end (>= 98%)
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
        renderCourses();
        setupEventListeners();
        setupAuthHandlers();
        updateStudentHeaderUI();

        // Listen for live Firebase & Student Auth sync updates
        window.addEventListener('courses-updated', () => renderCourses());
        window.addEventListener('storage', (e) => {
            if (e.key === 'useas_courses_v1') {
                renderCourses();
            }
        });
        window.addEventListener('student-auth-changed', () => {
            updateStudentHeaderUI();
            renderCourses();
        });
        window.addEventListener('progress-updated', () => {
            renderCourses();
            if (activeCourse) {
                const progress = window.UseasStore.getCourseProgress(activeCourse.id);
                updatePlayerProgressUI(progress);
                renderLessonsPlaylist();
            }
        });

        // Save active lesson video playback timestamp on tab close/unload
        window.addEventListener('beforeunload', () => {
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && activeCourse && activeLesson) {
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
    }

    function onPlayerStateChange(event) {
        if (event && typeof event.data === 'number') {
            if (event.data === 1) { // PLAYING
                isCurrentlyPlaying = true;
                updatePlayPauseUI(true);
            } else if (event.data === 2 || event.data === 0) { // PAUSED or ENDED
                isCurrentlyPlaying = false;
                updatePlayPauseUI(false);
            }
        }

        // Perform pending resume seek when video starts buffering (3) or playing (1)
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

        // YT.PlayerState.ENDED === 0
        if (event && event.data === 0) {
            if (activeCourse && activeLesson) {
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, true);
                updatePlayerProgressUI(newProgress);
                renderLessonsPlaylist();
                renderCourses();
                showToast('🎉 Lesson video completed! Progress updated.', 'success');
            }
        }
    }

    function setupEventListeners() {
        // Search Filter
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value.toLowerCase();
                renderCourses();
            });
        }

        // Category Filter Tags
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

        // Modal Close
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

        // Click to Play/Pause on Video Overlay (Prevents YouTube External Links & Popups)
        if (videoClickOverlay) {
            videoClickOverlay.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePlayPause();
            });
        }

        // Fullscreen Toggle Button
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    if (videoWrapper && videoWrapper.requestFullscreen) {
                        videoWrapper.requestFullscreen();
                    } else if (youtubeIframe && youtubeIframe.requestFullscreen) {
                        youtubeIframe.requestFullscreen();
                    }
                } else {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    }
                }
            });
        }

        // Mark as Complete Button Handler
        const toggleCompleteBtn = document.getElementById('toggleCompleteBtn');
        if (toggleCompleteBtn) {
            toggleCompleteBtn.addEventListener('click', () => {
                if (!activeCourse || !activeLesson) return;
                const currentProg = window.UseasStore.getCourseProgress(activeCourse.id);
                const isCurrentlyDone = currentProg.completedLessons.includes(activeLesson.id);
                const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, activeLesson.id, !isCurrentlyDone);

                updatePlayerProgressUI(newProgress);
                renderLessonsPlaylist();
                renderCourses();

                if (!isCurrentlyDone) {
                    showToast('🎉 Task/Lesson marked as completed!', 'success');
                } else {
                    showToast('Lesson marked as incomplete.', 'info');
                }
            });
        }

        // Previous / Next Lesson Buttons
        if (prevLessonBtn) {
            prevLessonBtn.addEventListener('click', () => navigateLesson(-1));
        }
        if (nextLessonBtn) {
            nextLessonBtn.addEventListener('click', () => navigateLesson(1));
        }

        // Custom Video Bar Handlers
        const customPlayPauseBtn = document.getElementById('customPlayPauseBtn');
        const customRewind10Btn = document.getElementById('customRewind10Btn');
        const customScrubSlider = document.getElementById('customScrubSlider');

        if (customPlayPauseBtn) {
            customPlayPauseBtn.addEventListener('click', () => {
                togglePlayPause();
            });
        }

        // 10 Seconds Rewind Button
        if (customRewind10Btn) {
            customRewind10Btn.addEventListener('click', () => {
                rewind10Seconds();
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

                    // Prevent fast-forwarding beyond maxWatchedTime (+ 2s buffer)
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

        // Keyboard navigation (ESC to close)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && playerModal && playerModal.classList.contains('active')) {
                closePlayerModal();
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

    // Toast Notification helper
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
        const color = type === 'success' ? 'var(--accent-green)' : 'var(--primary-dark)';

        toast.innerHTML = `
            <i class="fa-solid ${icon}" style="color: ${color}; font-size: 1.1rem;"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Render Course Cards
    function renderCourses() {
        if (!coursesGrid) return;

        const allCourses = window.UseasStore.getCourses();
        const filtered = (allCourses || []).filter(course => {
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
                } catch (err) {
                    console.error('Lottie load error:', err);
                }
            }
            return;
        }

        if (activeNoItemAnim) {
            try { activeNoItemAnim.destroy(); } catch (e) {}
            activeNoItemAnim = null;
        }

        const currentStudent = window.UseasStore.getCurrentStudent();

        coursesGrid.innerHTML = filtered.map(course => {
            const progress = window.UseasStore.getCourseProgress(course.id);
            const totalLessons = course.lessons ? course.lessons.length : 0;
            const isCompleted = progress.percentage === 100 && totalLessons > 0;
            const isRegistered = currentStudent ? window.UseasStore.isStudentRegisteredForCourse(course.id, currentStudent) : false;

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

        // Attach click events to cards
        coursesGrid.querySelectorAll('.course-card').forEach(card => {
            card.addEventListener('click', () => {
                const courseId = card.getAttribute('data-course-id');
                const student = window.UseasStore.getCurrentStudent();
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

    // Listen to registrations updates
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
            } catch (err) {
                console.error('Locked Lottie error:', err);
            }
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
        const currentStudent = window.UseasStore.getCurrentStudent();
        if (!currentStudent) {
            showLockedModal();
            return;
        }

        const course = window.UseasStore.getCourseById(courseId);
        if (!course) return;

        document.getElementById('regCourseIdInput').value = courseId;
        if (regCourseTitleSubtitle) {
            regCourseTitleSubtitle.textContent = `Registering for: ${course.title}`;
        }

        // Auto-fill available information from Student Profile automatically
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
            const currentStudent = window.UseasStore.getCurrentStudent();
            if (!currentStudent) {
                closeCourseRegistrationModal();
                showLockedModal();
                return;
            }

            const courseId = document.getElementById('regCourseIdInput').value;
            const course = window.UseasStore.getCourseById(courseId);
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
        // Check if student is logged in
        const currentStudent = window.UseasStore.getCurrentStudent();
        if (!currentStudent) {
            showLockedModal();
            return;
        }

        // Check if student is registered for this course
        const isRegistered = window.UseasStore.isStudentRegisteredForCourse(courseId, currentStudent);
        if (!isRegistered) {
            openCourseRegistrationModal(courseId);
            return;
        }

        const course = window.UseasStore.getCourseById(courseId);
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

        // Populate Modal Header
        modalCourseTitle.textContent = course.title;
        
        // Show Modal
        playerModal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Load Active Lesson
        loadLesson(activeLesson.id);
        renderLessonsPlaylist();
    }

    let activeWebcamStream = null;

    // Load Specific Lesson Step (Video, Text Page, or Exam)
    function loadLesson(lessonId) {
        const lesson = activeCourse.lessons.find(l => l.id === lessonId);
        if (!lesson) return;

        activeLesson = lesson;
        window.UseasStore.setLastWatched(activeCourse.id, lesson.id);

        const type = lesson.type || 'video';
        const videoWrap = document.getElementById('videoWrapper');
        const customBar = document.getElementById('customVideoBar');
        const textView = document.getElementById('textArticleView');
        const testView = document.getElementById('testOverviewView');

        // Stop video tracker if switching away
        stopCustomTimeTracker();

        if (type === 'video') {
            if (videoWrap) videoWrap.style.display = 'block';
            if (customBar) customBar.style.display = 'flex';
            if (textView) textView.style.display = 'none';
            if (testView) testView.style.display = 'none';

            // Retrieve saved playback timestamp for resuming video
            const savedTimestamp = window.UseasStore.getLessonTimestamp(activeCourse.id, lesson.id);
            const currentProgress = window.UseasStore.getCourseProgress(activeCourse.id);
            const isLessonDone = currentProgress.completedLessons.includes(lesson.id);
            maxWatchedTime = isLessonDone ? 999999 : (savedTimestamp || 0);

            pendingResumeTimestamp = (!isLessonDone && savedTimestamp > 2) ? savedTimestamp : 0;
            const startParam = pendingResumeTimestamp > 2 ? `&start=${Math.floor(pendingResumeTimestamp)}` : '';

            // Update YouTube Embed safely
            const videoId = lesson.videoId || window.UseasStore.extractYoutubeId(lesson.videoUrl);
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
            if (videoWrap) videoWrap.style.display = 'none';
            if (customBar) customBar.style.display = 'none';
            if (textView) textView.style.display = 'block';
            if (testView) testView.style.display = 'none';

            // Pause YT video if playing
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
            if (videoWrap) videoWrap.style.display = 'none';
            if (customBar) customBar.style.display = 'none';
            if (textView) textView.style.display = 'none';
            if (testView) testView.style.display = 'block';

            // Pause YT video if playing
            sendYTCommand('pauseVideo');

            const testOverviewTitle = document.getElementById('testOverviewTitle');
            const testOverviewDesc = document.getElementById('testOverviewDesc');
            const examStatusBox = document.getElementById('examStatusBox');
            const openExamPrecheckBtn = document.getElementById('openExamPrecheckBtn');

            if (testOverviewTitle) testOverviewTitle.textContent = lesson.title;
            if (testOverviewDesc) testOverviewDesc.textContent = lesson.description || (lesson.examData && lesson.examData.instructions) || 'Complete this online examination to advance in the course.';

            // Check previous exam score
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

        // Update Lesson Info Header
        modalLessonTitle.textContent = lesson.title;
        modalLessonDesc.textContent = lesson.description || 'Follow the step instructions to advance through the course.';

        // Update Navigation Counters
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

    // Pre-Exam Camera & Security Modal Logic
    function openPreExamModal() {
        const modal = document.getElementById('preExamModal');
        const badge = document.getElementById('webcamStatusBadge');
        const feed = document.getElementById('preExamWebcamFeed');
        const fallback = document.getElementById('camFallbackMsg');

        if (!modal) return;
        modal.classList.add('active');

        // Request live webcam camera stream
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
                .catch(err => {
                    console.warn('Webcam permission error:', err);
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

            // Open secure exam runner in separate browser tab
            const examUrl = `exam.html?courseId=${encodeURIComponent(activeCourse.id)}&lessonId=${encodeURIComponent(activeLesson.id)}`;
            window.open(examUrl, '_blank');
            showToast('🚀 Exam launched in secure window!', 'success');
        });
    }

    // Listen for progress-updated event when progress changes in Firebase (e.g. exam submitted in tab)
    window.addEventListener('progress-updated', () => {
        if (activeCourse && activeLesson) {
            const progress = window.UseasStore.getCourseProgress(activeCourse.id);
            updatePlayerProgressUI(progress);
            renderLessonsPlaylist();
            loadLesson(activeLesson.id);
        }
    });

    // Update Player Completion UI & Progress Bars
    function updatePlayerProgressUI(progress, liveRatio = 0) {
        if (!activeCourse || !activeLesson) return;

        let effectivePct = progress.percentage;
        if (progress.totalLessons > 0 && !progress.completedLessons.includes(activeLesson.id)) {
            const currentContrib = (liveRatio / progress.totalLessons) * 100;
            effectivePct = Math.min(100, Math.round(progress.percentage + currentContrib));
        }

        const isFullyComplete = effectivePct >= 100 || progress.percentage === 100;

        // Update Mark as Complete Button
        const btn = document.getElementById('toggleCompleteBtn');
        if (btn) {
            const isDone = progress.completedLessons.includes(activeLesson.id);
            if (isDone) {
                btn.classList.add('is-completed');
                btn.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> <span>Completed</span>`;
            } else {
                btn.classList.remove('is-completed');
                btn.innerHTML = `<i class="fa-regular fa-circle-check"></i> <span>Mark as Complete</span>`;
            }
        }

        // Update Modal Progress Sub-panel
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

    // Render Sidebar Playlist with Sequential Locks & Typed Badges
    function renderLessonsPlaylist() {
        if (!lessonsList || !activeCourse) return;

        const progress = window.UseasStore.getCourseProgress(activeCourse.id);

        lessonsList.innerHTML = activeCourse.lessons.map((lesson, index) => {
            const isDone = progress.completedLessons.includes(lesson.id);
            const isActive = activeLesson && activeLesson.id === lesson.id;
            
            // Check Sequential Lock (Step i requires Step i-1 to be completed)
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

        // Playlist Click Handlers
        lessonsList.querySelectorAll('.lesson-item').forEach(item => {
            const lessonId = item.getAttribute('data-lesson-id');
            const index = activeCourse.lessons.findIndex(l => l.id === lessonId);
            const isUnlocked = (index === 0) || progress.completedLessons.includes(activeCourse.lessons[index - 1].id);

            const checkBtn = item.querySelector('.lesson-check');
            if (checkBtn && isUnlocked) {
                checkBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isDone = progress.completedLessons.includes(lessonId);
                    const newProgress = window.UseasStore.toggleLessonComplete(activeCourse.id, lessonId, !isDone);
                    updatePlayerProgressUI(newProgress);
                    renderLessonsPlaylist();
                    renderCourses();
                });
            }

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
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && activeCourse && activeLesson) {
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
            youtubeIframe.src = ''; // Stop video audio
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

        const currentStudent = window.UseasStore.getCurrentStudent();

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
        const tabAbhyasBtn = document.getElementById('tabAbhyasBtn');
        const authModalTitle = document.getElementById('authModalTitle');
        const authErrorBox = document.getElementById('authErrorBox');

        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        const abhyasFormContainer = document.getElementById('abhyasFormContainer');
        const authSwitchPrompt = document.getElementById('authSwitchPrompt');

        // Abhyas Flow State & Elements
        let abhyasCurrentStudent = null;
        let abhyasCurrentOtp = null;

        const abhyasSucForm = document.getElementById('abhyasSucForm');
        const abhyasSucInput = document.getElementById('abhyasSucInput');
        const abhyasSucSubmitBtn = document.getElementById('abhyasSucSubmitBtn');

        const abhyasDetailsCard = document.getElementById('abhyasDetailsCard');
        const displayAbhyasSuc = document.getElementById('displayAbhyasSuc');
        const displayAbhyasName = document.getElementById('displayAbhyasName');
        const displayAbhyasEmail = document.getElementById('displayAbhyasEmail');
        const displayAbhyasGroup = document.getElementById('displayAbhyasGroup');
        const abhyasBackBtn = document.getElementById('abhyasBackBtn');
        const abhyasConfirmBtn = document.getElementById('abhyasConfirmBtn');

        const abhyasOtpForm = document.getElementById('abhyasOtpForm');
        const abhyasOtpInput = document.getElementById('abhyasOtpInput');
        const otpEmailTarget = document.getElementById('otpEmailTarget');
        const abhyasResendOtpBtn = document.getElementById('abhyasResendOtpBtn');
        const abhyasOtpSubmitBtn = document.getElementById('abhyasOtpSubmitBtn');

        // Initialize EmailJS Browser SDK
        if (window.emailjs) {
            try {
                emailjs.init({ publicKey: "MJPLwD9idjGcD_L--" });
            } catch (e) {
                console.warn("EmailJS init note:", e);
            }
        }

        // Toggle Profile Dropdown
        if (profileAvatarBtn && profileDropdown) {
            profileAvatarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActive = profileDropdown.classList.toggle('active');
                profileAvatarBtn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
            });
        }

        // Close profile dropdown when clicking outside
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

        function switchAuthTab(mode) {
            hideAuthError();
            if (mode === 'signup') {
                if (tabLoginBtn) tabLoginBtn.classList.remove('active');
                if (tabSignupBtn) tabSignupBtn.classList.add('active');
                if (tabAbhyasBtn) tabAbhyasBtn.classList.remove('active');

                if (loginForm) loginForm.style.display = 'none';
                if (signupForm) signupForm.style.display = 'flex';
                if (abhyasFormContainer) abhyasFormContainer.style.display = 'none';

                if (authModalTitle) authModalTitle.textContent = 'Create Student Account';
                if (authSwitchPrompt) {
                    authSwitchPrompt.innerHTML = `Already have an account? <a href="#" id="authSwitchLink" style="color: var(--primary-dark); font-weight: 700;">Log In here</a>`;
                    rebindSwitchLink();
                }
            } else if (mode === 'abhyas') {
                if (tabLoginBtn) tabLoginBtn.classList.remove('active');
                if (tabSignupBtn) tabSignupBtn.classList.remove('active');
                if (tabAbhyasBtn) tabAbhyasBtn.classList.add('active');

                if (loginForm) loginForm.style.display = 'none';
                if (signupForm) signupForm.style.display = 'none';
                if (abhyasFormContainer) abhyasFormContainer.style.display = 'flex';

                // Reset Abhyas steps to Step 1
                if (abhyasSucForm) abhyasSucForm.style.display = 'flex';
                if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
                if (abhyasOtpForm) abhyasOtpForm.style.display = 'none';

                if (authModalTitle) authModalTitle.textContent = 'Abhyas Student Verification';
                if (authSwitchPrompt) {
                    authSwitchPrompt.innerHTML = `Want standard email login? <a href="#" id="authSwitchLink" style="color: var(--primary-dark); font-weight: 700;">Log In here</a>`;
                    rebindSwitchLink();
                }
            } else {
                if (tabLoginBtn) tabLoginBtn.classList.add('active');
                if (tabSignupBtn) tabSignupBtn.classList.remove('active');
                if (tabAbhyasBtn) tabAbhyasBtn.classList.remove('active');

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
                window.UseasStore.logoutStudent();
                updateStudentHeaderUI();
                showToast('Logged out of student account.', 'info');
            });
        }

        if (tabLoginBtn) tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
        if (tabSignupBtn) tabSignupBtn.addEventListener('click', () => switchAuthTab('signup'));
        if (tabAbhyasBtn) tabAbhyasBtn.addEventListener('click', () => switchAuthTab('abhyas'));

        document.querySelectorAll('.abhyasTriggerBtn').forEach(btn => {
            btn.addEventListener('click', () => switchAuthTab('abhyas'));
        });

        rebindSwitchLink();

        // ----------------------------------------------------
        // ABHYAS FLOW HANDLERS
        // ----------------------------------------------------

        // Step 1: Submit 10-Digit SUC Code & Fetch API
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
                        abhyasCurrentStudent = {
                            sucCode: sucCode,
                            name: sData.name || sData.fullName || 'Abhyas Student',
                            email: sData.email || `${sucCode}@abhyas.edu.in`,
                            group: sData.group || sData.course || 'Abhyas Course'
                        };

                        // Populate details UI card
                        if (displayAbhyasSuc) displayAbhyasSuc.textContent = abhyasCurrentStudent.sucCode;
                        if (displayAbhyasName) displayAbhyasName.textContent = abhyasCurrentStudent.name;
                        const abhyasEmailInput = document.getElementById('abhyasEmailInput');
                        if (abhyasEmailInput) abhyasEmailInput.value = abhyasCurrentStudent.email;
                        if (displayAbhyasGroup) displayAbhyasGroup.textContent = abhyasCurrentStudent.group;

                        // Switch to Step 2
                        abhyasSucForm.style.display = 'none';
                        if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'flex';
                    } else {
                        showAuthError(json.message || `No student records found for SUC Code: ${sucCode}. Please check your code.`);
                    }
                } catch (err) {
                    console.error('Abhyas API Error:', err);
                    showAuthError('Unable to connect to Abhyas server. Please check your internet connection.');
                } finally {
                    if (abhyasSucSubmitBtn) {
                        abhyasSucSubmitBtn.disabled = false;
                        abhyasSucSubmitBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Submit & Fetch Details`;
                    }
                }
            });
        }

        // Back button in Step 2
        if (abhyasBackBtn) {
            abhyasBackBtn.addEventListener('click', () => {
                hideAuthError();
                if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
                if (abhyasSucForm) abhyasSucForm.style.display = 'flex';
            });
        }

        // Step 2: Confirm Student Details & Send OTP (Click OK)
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

        function sendAbhyasOtp() {
            if (!abhyasCurrentStudent) return;
            hideAuthError();

            const emailInput = document.getElementById('abhyasEmailInput');
            let targetEmail = (emailInput ? emailInput.value : '').trim().toLowerCase();

            if (!targetEmail || !targetEmail.includes('@')) {
                showAuthError('Please enter a valid email address to receive your OTP code.');
                return;
            }

            // Update current student record with verified email
            abhyasCurrentStudent.email = targetEmail;

            // Generate 6-digit OTP
            abhyasCurrentOtp = Math.floor(100000 + Math.random() * 900000).toString();

            if (abhyasConfirmBtn) {
                abhyasConfirmBtn.disabled = true;
                abhyasConfirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...`;
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

                // Attempt 1: Direct Fetch to EmailJS REST API
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
                        console.log('EmailJS REST API delivery success!');
                        showToast(`✉️ OTP sent successfully to ${targetEmail}! Check inbox & spam folder.`, 'success');
                        resolve(true);
                    } else {
                        return res.text().then(text => Promise.reject(new Error(text)));
                    }
                })
                .catch(restErr => {
                    console.warn('EmailJS REST API note, attempting SDK fallback:', restErr);

                    // Attempt 2: EmailJS Browser SDK
                    if (window.emailjs && !isSent) {
                        try {
                            if (window.emailjs.init) window.emailjs.init({ publicKey: 'MJPLwD9idjGcD_L--' });
                        } catch(e) {}

                        window.emailjs.send('useas_otpsender', 'template_5weozdp', templateParams, 'MJPLwD9idjGcD_L--')
                        .then((res) => {
                            isSent = true;
                            console.log('EmailJS SDK delivery success:', res);
                            showToast(`✉️ OTP sent successfully to ${targetEmail}!`, 'success');
                            resolve(true);
                        })
                        .catch((sdkErr) => {
                            console.error('EmailJS Delivery Error:', sdkErr);
                            showToast(`✉️ OTP sent to ${targetEmail}. (Check code: ${abhyasCurrentOtp})`, 'info');
                            resolve(false);
                        });
                    } else {
                        showToast(`✉️ OTP generated: ${abhyasCurrentOtp} (Sent to ${targetEmail})`, 'info');
                        resolve(false);
                    }
                });
            });

            sendPromise.then((isSuccess) => {
                if (abhyasConfirmBtn) {
                    abhyasConfirmBtn.disabled = false;
                    abhyasConfirmBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Confirm & Send OTP`;
                }

                if (otpEmailTarget) otpEmailTarget.textContent = targetEmail;

                const otpNotice = document.getElementById('otpDeliveryNotice');
                const otpFallback = document.getElementById('otpCodeFallback');
                if (otpNotice && otpFallback) {
                    otpFallback.textContent = abhyasCurrentOtp;
                    otpNotice.style.display = isSuccess ? 'none' : 'block';
                }

                if (abhyasDetailsCard) abhyasDetailsCard.style.display = 'none';
                if (abhyasOtpForm) abhyasOtpForm.style.display = 'flex';
                if (abhyasOtpInput) abhyasOtpInput.focus();

                startResendCountdown(30);
            });
        }

        if (abhyasConfirmBtn) {
            abhyasConfirmBtn.addEventListener('click', sendAbhyasOtp);
        }

        if (abhyasResendOtpBtn) {
            abhyasResendOtpBtn.addEventListener('click', () => {
                sendAbhyasOtp();
            });
        }

        // Step 3: Verify OTP & Complete Login
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
                    showAuthError('Invalid OTP code. Please check the email sent to ' + abhyasCurrentStudent.email + ' and try again.');
                    return;
                }

                // OTP Verified! Log in student via Store
                const res = window.UseasStore.loginOrRegisterAbhyasStudent(abhyasCurrentStudent);
                if (res.error) {
                    showAuthError(res.error);
                } else {
                    closeAuthModal();
                    abhyasSucInput.value = '';
                    abhyasOtpInput.value = '';
                    updateStudentHeaderUI();
                    showToast(`🎉 Welcome, ${abhyasCurrentStudent.name}! Logged in via Abhyas.`, 'success');
                }
            });
        }

        // Sign Up Form Submission
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

                // Double password match verification check
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

        // Log In Form Submission
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

    // Header Navigation Pill Light / Active State Toggle
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

    // Scroll Observer to dynamically update nav active light as user scrolls
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
