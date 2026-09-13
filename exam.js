/**
 * useas - Proctored Online Examination Runner (exam.js)
 * Live webcam camera feed monitoring, anti-cheating, devtools disabling, tab switch tracking, & scoring engine.
 */

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('courseId');
    const lessonId = urlParams.get('lessonId');

    // DOM Elements
    const examCourseTitle = document.getElementById('examCourseTitle');
    const examTitle = document.getElementById('examTitle');
    const examTimer = document.getElementById('examTimer');
    const examInstructions = document.getElementById('examInstructions');
    const questionsWrap = document.getElementById('questionsWrap');
    const examSubmitForm = document.getElementById('examSubmitForm');
    const examWebcamVideo = document.getElementById('examWebcamVideo');
    const violationBanner = document.getElementById('violationBanner');
    const violationMsg = document.getElementById('violationMsg');

    // Results Modal Elements
    const resultsModal = document.getElementById('resultsModal');
    const resultIconWrap = document.getElementById('resultIconWrap');
    const resultIcon = document.getElementById('resultIcon');
    const resultTitle = document.getElementById('resultTitle');
    const resultSubtitle = document.getElementById('resultSubtitle');
    const resultScorePct = document.getElementById('resultScorePct');
    const resultScoreFraction = document.getElementById('resultScoreFraction');
    const closeExamResultBtn = document.getElementById('closeExamResultBtn');

    // State
    let course = null;
    let lesson = null;
    let examData = null;
    let questions = [];
    let userAnswers = {};
    let timerInterval = null;
    let timeRemainingSec = 15 * 60;
    let violationCount = 0;
    let webcamStream = null;

    initExam();

    function initExam() {
        let targetCourseId = courseId;
        let targetLessonId = lessonId;

        // If no URL parameters provided (e.g. opened directly in browser), find first course with an exam step
        if (!targetCourseId || !targetLessonId) {
            const allCourses = window.UseasStore.getCourses();
            for (const c of allCourses) {
                const examLes = (c.lessons || []).find(l => l.type === 'test' && l.examData);
                if (examLes) {
                    targetCourseId = c.id;
                    targetLessonId = examLes.id;
                    break;
                }
            }
        }

        if (targetCourseId) {
            course = window.UseasStore.getCourseById(targetCourseId);
            if (course && targetLessonId) {
                lesson = (course.lessons || []).find(l => l.id === targetLessonId);
            }
        }

        // Fallback demo exam if no course/lesson parameters exist
        if (!course || !lesson || !lesson.examData) {
            course = course || { id: 'demo-course', title: 'Web Architecture & Engineering' };
            lesson = {
                id: 'demo-exam-1',
                title: 'Proctored Competency Examination',
                examData: {
                    durationMins: 15,
                    passPercentage: 60,
                    instructions: 'Mandatory Guidelines: Web camera and microphone MUST be active. Switching tabs or opening external developer tools is strictly monitored.',
                    questions: [
                        {
                            id: 'demo-q1',
                            question: 'What is the main role of HTML in modern web development?',
                            options: [
                                'Defining document structure and semantic content',
                                'Styling layout colors and fonts',
                                'Executing database transactions',
                                'Managing network socket connections'
                            ],
                            correctAnswer: 0
                        },
                        {
                            id: 'demo-q2',
                            question: 'Which HTTP request method is typically used to create new data on a server?',
                            options: ['GET', 'POST', 'DELETE', 'HEAD'],
                            correctAnswer: 1
                        },
                        {
                            id: 'demo-q3',
                            question: 'Which keyword is used to declare a block-scoped variable in modern JavaScript?',
                            options: ['var', 'let', 'global', 'static'],
                            correctAnswer: 1
                        }
                    ]
                }
            };
        }

        examData = lesson.examData;
        questions = examData.questions || [];

        // Set Headers
        if (examCourseTitle) examCourseTitle.textContent = course.title;
        if (examTitle) examTitle.textContent = lesson.title;
        if (examInstructions) examInstructions.textContent = examData.instructions || 'No cheating allowed. Camera & microphone MUST be on. Tab switching is strictly monitored.';

        // Setup Anti-Cheating Protection
        setupSecurityProtections();

        // Initialize Live Webcam Stream
        initWebcamStream();

        // Render Questions
        renderQuestions();

        // Start Countdown Timer
        const durationMins = parseInt(examData.durationMins, 10) || 15;
        timeRemainingSec = durationMins * 60;
        startTimer();

        // Form Submit
        if (examSubmitForm) {
            examSubmitForm.addEventListener('submit', (e) => {
                e.preventDefault();
                submitExam();
            });
        }
    }

    // Security & Anti-Cheating Protections
    function setupSecurityProtections() {
        // 1. Disable Right-Click Context Menu
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showViolation('Right-clicking is disabled during examination.');
        });

        // 2. Disable Developer Tools & Inspect Shortcuts
        document.addEventListener('keydown', (e) => {
            if (
                e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
                (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's')) ||
                (e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j'))
            ) {
                e.preventDefault();
                showViolation('Developer options & inspection tools are disabled!');
            }
        });

        // 3. Detect Tab Switching / Page Visibility Loss
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                violationCount++;
                showViolation(`⚠️ Warning: Leaving exam tab detected! (Violation ${violationCount}/3)`);
            }
        });

        window.addEventListener('blur', () => {
            violationCount++;
            showViolation(`⚠️ Warning: Focus left exam window! (Violation ${violationCount}/3)`);
        });
    }

    function showViolation(msg) {
        if (!violationBanner || !violationMsg) return;
        violationMsg.textContent = msg;
        violationBanner.style.display = 'flex';
        setTimeout(() => {
            violationBanner.style.display = 'none';
        }, 4000);
    }

    // Live Webcam Initialization
    function initWebcamStream() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                .then(stream => {
                    webcamStream = stream;
                    if (examWebcamVideo) {
                        examWebcamVideo.srcObject = stream;
                    }
                })
                .catch(err => {
                    console.warn('Webcam stream permission notice:', err);
                    showViolation('⚠️ Camera access denied or not found. Please enable your webcam.');
                });
        }
    }

    function stopWebcamStream() {
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
        }
    }

    // Timer Countdown
    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        updateTimerDisplay();

        timerInterval = setInterval(() => {
            timeRemainingSec--;
            updateTimerDisplay();

            if (timeRemainingSec <= 0) {
                clearInterval(timerInterval);
                alert('⏳ Time expired! Auto-submitting your examination.');
                submitExam();
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        if (!examTimer) return;
        const mins = Math.floor(timeRemainingSec / 60);
        const secs = timeRemainingSec % 60;
        const formattedMins = mins < 10 ? `0${mins}` : `${mins}`;
        const formattedSecs = secs < 10 ? `0${secs}` : `${secs}`;
        examTimer.textContent = `${formattedMins}:${formattedSecs}`;
    }

    // Render Quiz Questions
    function renderQuestions() {
        if (!questionsWrap) return;

        if (questions.length === 0) {
            questionsWrap.innerHTML = `
                <div class="exam-card" style="text-align: center;">
                    <p style="color: var(--text-dim);">No questions configured for this exam.</p>
                </div>
            `;
            return;
        }

        questionsWrap.innerHTML = questions.map((q, qIdx) => `
            <div class="exam-card" data-question-idx="${qIdx}">
                <div style="font-size: 0.8rem; color: var(--accent-cyan); font-weight: 700; margin-bottom: 0.4rem;">
                    QUESTION ${qIdx + 1} OF ${questions.length}
                </div>
                <h3 style="font-size: 1.15rem; color: #fff; margin-bottom: 1.25rem; font-weight: 600;">
                    ${q.question}
                </h3>

                <div class="options-group">
                    ${(q.options || []).map((optText, optIdx) => `
                        <label class="option-label" data-q-idx="${qIdx}" data-opt-idx="${optIdx}">
                            <input type="radio" name="q_${qIdx}" value="${optIdx}">
                            <span><strong>${String.fromCharCode(65 + optIdx)}.</strong> ${optText}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');

        // Attach option click listeners
        questionsWrap.querySelectorAll('.option-label').forEach(label => {
            label.addEventListener('click', () => {
                const qIdx = parseInt(label.getAttribute('data-q-idx'), 10);
                const optIdx = parseInt(label.getAttribute('data-opt-idx'), 10);
                
                // Highlight option
                const parentCard = label.closest('.exam-card');
                if (parentCard) {
                    parentCard.querySelectorAll('.option-label').forEach(l => l.classList.remove('selected'));
                }
                label.classList.add('selected');

                const radio = label.querySelector('input[type="radio"]');
                if (radio) radio.checked = true;

                userAnswers[qIdx] = optIdx;
            });
        });
    }

    // Submit Exam & Calculate Score
    function submitExam() {
        if (timerInterval) clearInterval(timerInterval);

        let correctCount = 0;
        const totalQuestions = questions.length;

        questions.forEach((q, idx) => {
            const selectedOpt = userAnswers[idx];
            if (selectedOpt !== undefined && parseInt(selectedOpt, 10) === parseInt(q.correctAnswer, 10)) {
                correctCount++;
            }
        });

        const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 100;
        const passPercentage = examData.passPercentage || 60;
        const passed = percentage >= passPercentage;

        const resultPayload = {
            score: correctCount,
            totalQuestions: totalQuestions,
            percentage: percentage,
            passed: passed
        };

        // Save result in Store
        window.UseasStore.saveExamResult(course.id, lesson.id, resultPayload);

        // Show Results Modal
        if (resultScorePct) resultScorePct.textContent = `${percentage}%`;
        if (resultScoreFraction) resultScoreFraction.textContent = `${correctCount} of ${totalQuestions} Correct Answers`;

        if (resultsModal && resultIconWrap && resultIcon && resultTitle && resultSubtitle) {
            if (passed) {
                resultIconWrap.style.background = 'rgba(16, 185, 129, 0.2)';
                resultIconWrap.style.color = 'var(--accent-green)';
                resultIcon.className = 'fa-solid fa-trophy';
                resultTitle.textContent = '🎉 Examination Passed!';
                resultSubtitle.textContent = `Congratulations! You scored ${percentage}% (Passing score is ${passPercentage}%).`;
            } else {
                resultIconWrap.style.background = 'rgba(239, 68, 68, 0.2)';
                resultIconWrap.style.color = 'var(--accent-red)';
                resultIcon.className = 'fa-solid fa-circle-xmark';
                resultTitle.textContent = '❌ Examination Failed';
                resultSubtitle.textContent = `You scored ${percentage}%. You need ${passPercentage}% or higher to pass. You can retake the test.`;
            }
            resultsModal.classList.add('active');
        }

        stopWebcamStream();

        if (closeExamResultBtn) {
            closeExamResultBtn.onclick = () => {
                window.close();
            };
        }
    }
});
