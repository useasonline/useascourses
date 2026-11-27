/**
 * useas - Data Store & State Management Module (store.js)
 * Safely merges LocalStorage + Firebase Realtime Database so newly created courses & videos never get overwritten.
 */

const STORAGE_KEYS = {
    COURSES: 'useas_courses_v1',
    PROGRESS: 'useas_progress_v1',
    STUDENTS: 'useas_students_v1',
    CURRENT_STUDENT: 'useas_current_student_v1',
    REGISTRATIONS: 'useas_registrations_v1',
    ADMIN_PROFILE: 'useas_admin_profile_v1',
    ADMIN_SESSION: 'useas_admin_session_v1'
};

const DEFAULT_ADMIN_PROFILE = {
    email: 'ssrdevelopers@gmail.com',
    name: 'SSR Developers Admin',
    password: 'adminpassword',
    photo: ''
};

const DEFAULT_COURSES = [
    {
        id: 'course-101',
        title: 'Full-Stack Web Development Bootcamp',
        category: 'Web Development',
        level: 'Beginner',
        thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=800&q=80',
        description: 'Learn HTML, CSS, JavaScript, React, and Node.js to build modern web applications from scratch.',
        lessons: [
            {
                id: 'les-101-1',
                type: 'video',
                title: '1. HTML5 & CSS3 Masterclass (Video)',
                videoUrl: 'https://www.youtube.com/watch?v=G3e-cpL7ofc',
                videoId: 'G3e-cpL7ofc',
                duration: '15 mins',
                description: 'Introduction to document structures, semantic markup, CSS Grid and Flexbox.'
            },
            {
                id: 'les-101-2',
                type: 'test',
                title: '2. HTML & Web Architecture Proctored Test (Exam)',
                duration: '15 mins',
                description: 'Proctored online examination on HTML5 semantics and modern web browser architecture.',
                examData: {
                    durationMins: 15,
                    passPercentage: 60,
                    instructions: 'Rules: No cheating allowed. Camera & microphone MUST be active throughout the test. Tab switching is strictly monitored and flagged.',
                    questions: [
                        {
                            id: 'q1',
                            question: 'What does HTML stand for?',
                            options: [
                                'Hyper Text Markup Language',
                                'High Tech Modern Language',
                                'Hyperlink Text Machine Language',
                                'Home Tool Markup Language'
                            ],
                            correctAnswer: 0
                        },
                        {
                            id: 'q2',
                            question: 'Which HTML element is used for the largest heading?',
                            options: ['<heading>', '<h6>', '<h1>', '<head>'],
                            correctAnswer: 2
                        },
                        {
                            id: 'q3',
                            question: 'What is the correct HTML element for inserting a line break?',
                            options: ['<break>', '<br>', '<lb>', '<newline>'],
                            correctAnswer: 1
                        }
                    ]
                }
            },
            {
                id: 'les-101-3',
                type: 'text',
                title: '3. Modern Frontend Architecture Notes (Article)',
                duration: '5 mins',
                description: 'Essential reading on Component-Based Architecture and State Management.',
                textContent: '### Modern Web Architecture Overview\n\nModern frontend web applications rely on key principles:\n\n1. **Component-Driven Architecture**: Building user interfaces using small, isolated, and reusable component blocks.\n2. **Declarative State Management**: Keeping state localized or central while automatically re-rendering target DOM trees.\n3. **Single Page Applications (SPAs)**: Routing client-side without full page reloads to maximize user experience speed.'
            }
        ]
    },
    {
        id: 'course-102',
        title: 'Python Programming Essentials',
        category: 'Programming',
        level: 'All Levels',
        thumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
        description: 'Master Python fundamentals, data structures, object-oriented programming, and automation scripts.',
        lessons: [
            {
                id: 'les-102-1',
                type: 'video',
                title: '1. Python Installation & Fundamentals',
                videoUrl: 'https://www.youtube.com/watch?v=rfscVS0vtbw',
                videoId: 'rfscVS0vtbw',
                duration: '12 mins',
                description: 'Setting up Python environment, variables, data types, and basic operations.'
            },
            {
                id: 'les-102-2',
                type: 'test',
                title: '2. Python Core Knowledge Test',
                duration: '10 mins',
                description: 'Assess your knowledge of Python variables, data structures, and loop statements.',
                examData: {
                    durationMins: 10,
                    passPercentage: 60,
                    instructions: 'Camera and microphone must be enabled. No switching tabs or opening external search tools.',
                    questions: [
                        {
                            id: 'py-q1',
                            question: 'What keyword is used to define a function in Python?',
                            options: ['func', 'def', 'function', 'create'],
                            correctAnswer: 1
                        },
                        {
                            id: 'py-q2',
                            question: 'Which data type is mutable in Python?',
                            options: ['Tuple', 'String', 'List', 'Integer'],
                            correctAnswer: 2
                        }
                    ]
                }
            }
        ]
    }
];

class StoreManager {
    constructor() {
        this.courses = [];
        this.progress = {};
        this.students = [];
        this.registrations = [];
        this.currentStudent = null;
        this.adminProfile = { ...DEFAULT_ADMIN_PROFILE };
        this.firebaseAttached = false;
        this.deletedCourseIds = new Set();

        this.initStore();
        this.setupFirebaseSync();
    }

    initStore() {
        try {
            const savedAdmin = localStorage.getItem(STORAGE_KEYS.ADMIN_PROFILE);
            if (savedAdmin) {
                this.adminProfile = { ...DEFAULT_ADMIN_PROFILE, ...JSON.parse(savedAdmin) };
            } else {
                this.adminProfile = { ...DEFAULT_ADMIN_PROFILE };
                localStorage.setItem(STORAGE_KEYS.ADMIN_PROFILE, JSON.stringify(this.adminProfile));
            }

            const savedCourses = localStorage.getItem(STORAGE_KEYS.COURSES);
            if (savedCourses !== null) {
                const parsed = JSON.parse(savedCourses);
                this.courses = Array.isArray(parsed) ? parsed.filter(c => c && typeof c === 'object' && c.id) : [];
            } else {
                this.courses = [...DEFAULT_COURSES];
                localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
            }

            const savedProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS);
            this.progress = savedProgress ? JSON.parse(savedProgress) : {};

            const savedStudents = localStorage.getItem(STORAGE_KEYS.STUDENTS);
            this.students = savedStudents ? JSON.parse(savedStudents) : [];

            const savedCurrentStudent = localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT);
            this.currentStudent = savedCurrentStudent ? JSON.parse(savedCurrentStudent) : null;

            const savedRegistrations = localStorage.getItem(STORAGE_KEYS.REGISTRATIONS);
            this.registrations = savedRegistrations ? JSON.parse(savedRegistrations) : [];
        } catch (e) {
            console.error('Store initialization error:', e);
            this.courses = [...DEFAULT_COURSES];
            this.progress = {};
            this.students = [];
            this.currentStudent = null;
            this.registrations = [];
            this.adminProfile = { ...DEFAULT_ADMIN_PROFILE };
        }
    }

    setupFirebaseSync() {
        const attachListeners = () => {
            if (this.firebaseAttached || typeof window === 'undefined' || !window.UseasFirebase) return;
            this.firebaseAttached = true;

            if (typeof window.UseasFirebase.listenAdminProfile === 'function') {
                window.UseasFirebase.listenAdminProfile((cloudAdmin) => {
                    if (cloudAdmin && typeof cloudAdmin === 'object' && cloudAdmin.email) {
                        this.adminProfile = { ...DEFAULT_ADMIN_PROFILE, ...cloudAdmin };
                        localStorage.setItem(STORAGE_KEYS.ADMIN_PROFILE, JSON.stringify(this.adminProfile));
                        window.dispatchEvent(new CustomEvent('admin-profile-updated'));
                    } else {
                        window.UseasFirebase.saveAdminProfileToCloud(this.adminProfile);
                    }
                });
            }

            // Merge cloud courses with local courses so newly created local courses are never overwritten
            window.UseasFirebase.listenCourses((cloudCourses) => {
                const localCourses = this.getCourses();

                if (cloudCourses === null) {
                    if (localCourses.length > 0) {
                        window.UseasFirebase.syncCoursesToCloud(localCourses);
                    }
                } else if (Array.isArray(cloudCourses)) {
                    const validCloud = cloudCourses.filter(c => c && typeof c === 'object' && c.id && !this.deletedCourseIds.has(c.id));
                    const mergedMap = new Map();

                    validCloud.forEach(c => mergedMap.set(c.id, c));
                    localCourses.forEach(localC => {
                        const cloudC = mergedMap.get(localC.id);
                        if (!cloudC || (localC.updatedAt || 0) >= (cloudC.updatedAt || 0)) {
                            mergedMap.set(localC.id, localC);
                        }
                    });

                    this.courses = Array.from(mergedMap.values());
                    localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
                }

                window.dispatchEvent(new CustomEvent('courses-updated'));
            });

            window.UseasFirebase.listenProgress((cloudProgress) => {
                if (cloudProgress && typeof cloudProgress === 'object') {
                    this.progress = { ...this.progress, ...cloudProgress };
                    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
                    window.dispatchEvent(new CustomEvent('progress-updated'));
                }
            });

            window.UseasFirebase.listenStudents((cloudStudents) => {
                if (Array.isArray(cloudStudents) && cloudStudents.length > 0) {
                    const validStudents = cloudStudents.filter(s => s && typeof s === 'object' && (s.id || s.sucCode));
                    if (validStudents.length > 0) {
                        const mergedMap = new Map();
                        this.getStudents().forEach(s => mergedMap.set(s.id || s.sucCode, s));
                        validStudents.forEach(s => mergedMap.set(s.id || s.sucCode, s));
                        this.students = Array.from(mergedMap.values());
                        localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));

                        if (this.currentStudent) {
                            const updated = this.students.find(s =>
                                s.id === this.currentStudent.id ||
                                (s.sucCode && this.currentStudent.sucCode && s.sucCode.toLowerCase() === this.currentStudent.sucCode.toLowerCase())
                            );
                            if (updated) {
                                this.currentStudent = updated;
                                localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(updated));
                            }
                        }
                        window.dispatchEvent(new CustomEvent('student-auth-changed'));
                    }
                } else if (this.getStudents().length > 0) {
                    window.UseasFirebase.syncStudentsToCloud(this.getStudents());
                }
            });

            window.UseasFirebase.listenRegistrations((cloudRegistrations) => {
                if (Array.isArray(cloudRegistrations) && cloudRegistrations.length > 0) {
                    const validRegs = cloudRegistrations.filter(r => r && typeof r === 'object');
                    const mergedMap = new Map();
                    this.getCourseRegistrations().forEach(r => mergedMap.set(r.id || `${r.courseId}_${r.sucCode}`, r));
                    validRegs.forEach(r => mergedMap.set(r.id || `${r.courseId}_${r.sucCode}`, r));
                    this.registrations = Array.from(mergedMap.values());
                    localStorage.setItem(STORAGE_KEYS.REGISTRATIONS, JSON.stringify(this.registrations));
                    window.dispatchEvent(new CustomEvent('registrations-updated'));
                } else if (this.getCourseRegistrations().length > 0) {
                    window.UseasFirebase.syncRegistrationsToCloud(this.getCourseRegistrations());
                }
            });
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('firebase-ready', attachListeners);
            if (window.UseasFirebase) attachListeners();
        }
    }

    // ==================== ADMIN METHODS ====================
    getAdminProfile() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_PROFILE);
            if (saved) {
                this.adminProfile = { ...DEFAULT_ADMIN_PROFILE, ...JSON.parse(saved) };
            }
        } catch (e) {}
        return { ...DEFAULT_ADMIN_PROFILE, ...(this.adminProfile || {}) };
    }

    verifyAdminLogin(identifier, password) {
        const profile = this.getAdminProfile();
        const normId = (identifier || '').trim().toLowerCase();
        const validEmail = (profile.email || '').trim().toLowerCase();
        const validName = (profile.name || '').trim().toLowerCase();

        if ((normId === validEmail || normId === validName) && password === profile.password) {
            try {
                sessionStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
            } catch (e) {}
            return { success: true, profile };
        }
        return { error: 'Invalid Admin Email/Name or Password.' };
    }

    isAdminAuthenticated() {
        try {
            return sessionStorage.getItem(STORAGE_KEYS.ADMIN_SESSION) === 'true';
        } catch (e) {
            return false;
        }
    }

    logoutAdmin() {
        try {
            sessionStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
        } catch (e) {}
    }

    updateAdminProfile(updates) {
        const current = this.getAdminProfile();
        this.adminProfile = {
            ...current,
            email: (updates.email !== undefined && updates.email.trim() !== '') ? updates.email.trim() : current.email,
            name: (updates.name !== undefined && updates.name.trim() !== '') ? updates.name.trim() : current.name,
            password: (updates.password && updates.password.trim() !== '') ? updates.password : current.password,
            photo: updates.photo !== undefined ? updates.photo : current.photo
        };

        try {
            localStorage.setItem(STORAGE_KEYS.ADMIN_PROFILE, JSON.stringify(this.adminProfile));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase && typeof window.UseasFirebase.saveAdminProfileToCloud === 'function') {
            window.UseasFirebase.saveAdminProfileToCloud(this.adminProfile);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('admin-profile-updated'));
        }
        return this.adminProfile;
    }

    // ==================== YOUTUBE PARSER ====================
    extractYoutubeId(urlOrId) {
        if (!urlOrId) return '';
        const trimmed = urlOrId.trim();
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
            return trimmed;
        }
        const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=))([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) {
            return match[1];
        }
        const fallback = trimmed.match(/([a-zA-Z0-9_-]{11})/);
        return fallback ? fallback[1] : trimmed;
    }

    // ==================== COURSE METHODS ====================
    getCourses() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.COURSES);
            if (saved !== null) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    this.courses = parsed.filter(c => c && typeof c === 'object' && c.id);
                }
            }
        } catch (e) {}
        return (this.courses || []).filter(c => c && typeof c === 'object' && c.id);
    }

    getCourseById(courseId) {
        return this.getCourses().find(c => c.id === courseId) || null;
    }

    saveCourse(courseData) {
        const currentCourses = this.getCourses();
        const existingIndex = currentCourses.findIndex(c => c && c.id === courseData.id);
        const now = Date.now();
        
        let targetCourse;
        if (existingIndex >= 0) {
            currentCourses[existingIndex] = {
                lessons: [],
                ...currentCourses[existingIndex],
                ...courseData,
                updatedAt: now
            };
            targetCourse = currentCourses[existingIndex];
        } else {
            targetCourse = {
                id: courseData.id || ('course-' + now),
                lessons: [],
                ...courseData,
                updatedAt: now
            };
            currentCourses.unshift(targetCourse);
        }

        this.deletedCourseIds.delete(targetCourse.id);
        this.courses = currentCourses.filter(c => c && typeof c === 'object' && c.id);

        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {
            console.error('LocalStorage saveCourse error:', e);
        }

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(targetCourse);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return targetCourse;
    }

    deleteCourse(courseId) {
        this.deletedCourseIds.add(courseId);
        this.courses = this.getCourses().filter(c => c && c.id !== courseId);
        
        if (this.progress[courseId]) {
            delete this.progress[courseId];
        }

        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.deleteCourseFromCloud(courseId);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
            window.dispatchEvent(new CustomEvent('progress-updated'));
        }
    }

    saveLesson(courseId, lessonData) {
        const currentCourses = this.getCourses();
        const course = currentCourses.find(c => c.id === courseId);
        if (!course) return false;

        if (!course.lessons) course.lessons = [];

        const type = lessonData.type || 'video';
        const videoId = type === 'video' ? this.extractYoutubeId(lessonData.videoUrl || lessonData.videoId) : '';

        const lessonPayload = {
            id: lessonData.id || ('les-' + Date.now()),
            type: type,
            title: lessonData.title || 'Untitled Lesson',
            videoUrl: lessonData.videoUrl || '',
            videoId: videoId,
            duration: lessonData.duration || '10 mins',
            description: lessonData.description || '',
            textContent: lessonData.textContent || '',
            examData: lessonData.examData || null
        };

        const existingIdx = course.lessons.findIndex(l => l && l.id === lessonPayload.id);
        if (existingIdx >= 0) {
            course.lessons[existingIdx] = lessonPayload;
        } else {
            course.lessons.push(lessonPayload);
        }

        course.updatedAt = Date.now();
        this.courses = currentCourses;

        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(course);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return lessonPayload;
    }

    deleteLesson(courseId, lessonId) {
        const currentCourses = this.getCourses();
        const course = currentCourses.find(c => c.id === courseId);
        if (!course) return false;

        course.lessons = (course.lessons || []).filter(l => l && l.id !== lessonId);
        course.updatedAt = Date.now();
        this.courses = currentCourses;

        this.toggleLessonComplete(courseId, lessonId, false);

        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(course);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return true;
    }

    // ==================== PROGRESS METHODS ====================
    getProgressKey(courseId) {
        const student = this.getCurrentStudent();
        if (student && student.id) {
            return `${student.id}_${courseId}`;
        }
        return courseId;
    }

    saveExamResult(courseId, lessonId, scoreData) {
        const key = this.getProgressKey(courseId);
        if (!this.progress[key]) {
            this.progress[key] = { completedLessons: [], lastWatchedLessonId: lessonId, timestamps: {}, examResults: {} };
        }
        if (!this.progress[key].examResults) {
            this.progress[key].examResults = {};
        }

        this.progress[key].examResults[lessonId] = {
            score: scoreData.score || 0,
            totalQuestions: scoreData.totalQuestions || 0,
            percentage: scoreData.percentage || 0,
            passed: scoreData.passed || false,
            attemptedAt: Date.now()
        };

        if (scoreData.passed) {
            if (!this.progress[key].completedLessons.includes(lessonId)) {
                this.progress[key].completedLessons.push(lessonId);
            }
        }

        try {
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveProgressToCloud(key, this.progress[key]);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('progress-updated'));
        }

        return this.progress[key].examResults[lessonId];
    }

    getExamResult(courseId, lessonId) {
        const key = this.getProgressKey(courseId);
        const courseProgress = this.progress[key] || this.progress[courseId];
        if (courseProgress && courseProgress.examResults && courseProgress.examResults[lessonId]) {
            return courseProgress.examResults[lessonId];
        }
        return null;
    }

    getAllProgress() {
        return this.progress || {};
    }

    getCourseProgress(courseId) {
        const key = this.getProgressKey(courseId);
        const courseProgress = this.progress[key] || this.progress[courseId] || { completedLessons: [], lastWatchedLessonId: null, timestamps: {} };
        const course = this.getCourseById(courseId);
        
        if (!course || !course.lessons || course.lessons.length === 0) {
            return {
                completedCount: 0,
                totalLessons: 0,
                percentage: 0,
                completedLessons: [],
                lastWatchedLessonId: null,
                timestamps: courseProgress.timestamps || {}
            };
        }

        const totalLessons = course.lessons.length;
        const validCompleted = (courseProgress.completedLessons || []).filter(id => course.lessons.some(l => l.id === id));
        const completedCount = validCompleted.length;
        const percentage = Math.round((completedCount / totalLessons) * 100);

        return {
            completedCount,
            totalLessons,
            percentage,
            completedLessons: validCompleted,
            lastWatchedLessonId: courseProgress.lastWatchedLessonId || (course.lessons[0] ? course.lessons[0].id : null),
            timestamps: courseProgress.timestamps || {}
        };
    }

    toggleLessonComplete(courseId, lessonId, forceState = null) {
        const key = this.getProgressKey(courseId);
        if (!this.progress[key]) {
            this.progress[key] = { completedLessons: [], lastWatchedLessonId: lessonId, timestamps: {} };
        }

        let completed = this.progress[key].completedLessons || [];
        const isAlreadyComplete = completed.includes(lessonId);

        let newState = forceState !== null ? forceState : !isAlreadyComplete;

        if (newState && !isAlreadyComplete) {
            completed.push(lessonId);
        } else if (!newState && isAlreadyComplete) {
            completed = completed.filter(id => id !== lessonId);
        }

        this.progress[key].completedLessons = completed;
        this.progress[key].lastWatchedLessonId = lessonId;

        try {
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveProgressToCloud(key, this.progress[key]);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('progress-updated'));
        }

        return this.getCourseProgress(courseId);
    }

    setLastWatched(courseId, lessonId) {
        const key = this.getProgressKey(courseId);
        if (!this.progress[key]) {
            this.progress[key] = { completedLessons: [], lastWatchedLessonId: lessonId, timestamps: {} };
        } else {
            this.progress[key].lastWatchedLessonId = lessonId;
        }

        try {
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveProgressToCloud(key, this.progress[key]);
        }
    }

    saveLessonTimestamp(courseId, lessonId, timeInSeconds) {
        if (!courseId || !lessonId || isNaN(timeInSeconds) || timeInSeconds < 0) return;
        const key = this.getProgressKey(courseId);

        if (!this.progress[key]) {
            this.progress[key] = { completedLessons: [], lastWatchedLessonId: lessonId, timestamps: {} };
        }
        if (!this.progress[key].timestamps) {
            this.progress[key].timestamps = {};
        }

        const existing = this.progress[key].timestamps[lessonId] || 0;
        const floorTime = Math.floor(timeInSeconds);

        if (Math.abs(existing - floorTime) < 2) return;

        this.progress[key].timestamps[lessonId] = floorTime;
        this.progress[key].lastWatchedLessonId = lessonId;

        try {
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveProgressToCloud(key, this.progress[key]);
        }
    }

    getLessonTimestamp(courseId, lessonId) {
        if (!courseId || !lessonId) return 0;
        const key = this.getProgressKey(courseId);
        const courseProgress = this.progress[key] || this.progress[courseId];
        if (courseProgress && courseProgress.timestamps && courseProgress.timestamps[lessonId]) {
            return courseProgress.timestamps[lessonId] || 0;
        }
        return 0;
    }

    // ==================== STUDENT AUTH METHODS ====================
    getStudents() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.STUDENTS);
            if (saved) this.students = JSON.parse(saved);
        } catch (e) {}
        return this.students || [];
    }

    getCurrentStudent() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT);
            if (saved) this.currentStudent = JSON.parse(saved);
        } catch (e) {}
        return this.currentStudent;
    }

    registerStudent({ fullName, sucCode, email, password }) {
        const allStudents = this.getStudents();
        const normSuc = sucCode.trim().toLowerCase();
        const normEmail = email.trim().toLowerCase();

        const sucExists = allStudents.some(s => s.sucCode && s.sucCode.toLowerCase() === normSuc);
        if (sucExists) {
            return { error: 'This Student SUC Code is already registered. Please log in.' };
        }
        const emailExists = allStudents.some(s => s.email && s.email.toLowerCase() === normEmail);
        if (emailExists) {
            return { error: 'This Student Email is already registered. Please log in.' };
        }

        const newStudent = {
            id: 'std-' + Date.now(),
            fullName: fullName.trim(),
            sucCode: normSuc.toUpperCase(),
            email: normEmail,
            password: password,
            createdAt: Date.now()
        };

        allStudents.push(newStudent);
        this.students = allStudents;
        this.currentStudent = newStudent;

        try {
            localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));
            localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(newStudent));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveStudentToCloud(newStudent);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('student-auth-changed'));
        }
        return { success: true, student: newStudent };
    }

    loginStudent(identifier, password) {
        const allStudents = this.getStudents();
        const normId = identifier.trim().toLowerCase();

        const found = allStudents.find(s => 
            (s.sucCode && s.sucCode.toLowerCase() === normId) || 
            (s.email && s.email.toLowerCase() === normId)
        );

        if (!found) {
            return { error: 'No student account found with this SUC Code or Email.' };
        }

        if (found.password !== password) {
            return { error: 'Incorrect password. Please check and try again.' };
        }

        this.currentStudent = found;

        try {
            localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(found));
        } catch (e) {}

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('student-auth-changed'));
        }
        return { success: true, student: found };
    }

    loginOrRegisterAbhyasStudent({ name, email, group, sucCode, password }) {
        const allStudents = this.getStudents();
        const normSuc = (sucCode || '').trim().toUpperCase();
        const normEmail = (email || '').trim().toLowerCase();

        let found = allStudents.find(s => 
            (s.sucCode && s.sucCode.toUpperCase() === normSuc) || 
            (s.email && s.email.toLowerCase() === normEmail)
        );

        if (!found) {
            found = {
                id: 'std-abhyas-' + Date.now(),
                fullName: name,
                sucCode: normSuc,
                email: normEmail,
                group: group || '',
                isAbhyas: true,
                createdAt: Date.now()
            };
            if (password) found.password = password;
            allStudents.push(found);
        } else {
            found.fullName = name || found.fullName;
            found.group = group || found.group;
            found.sucCode = normSuc || found.sucCode;
            if (password) found.password = password;
        }

        this.students = allStudents;
        this.currentStudent = found;
        try {
            localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));
            localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(found));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveStudentToCloud(found);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('student-auth-changed'));
        }
        return { success: true, student: found };
    }

    getStudentBySucOrEmail(sucCode, email) {
        const allStudents = this.getStudents();
        const normSuc = (sucCode || '').trim().toUpperCase();
        const normEmail = (email || '').trim().toLowerCase();

        return allStudents.find(s => 
            (s.sucCode && s.sucCode.toUpperCase() === normSuc) || 
            (s.email && s.email.toLowerCase() === normEmail)
        ) || null;
    }

    logoutStudent() {
        this.currentStudent = null;
        try {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT);
        } catch (e) {}

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('student-auth-changed'));
        }
    }

    // ==================== COURSE REGISTRATION METHODS ====================
    getCourseRegistrations() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.REGISTRATIONS);
            if (saved) this.registrations = JSON.parse(saved);
        } catch (e) {}
        return this.registrations || [];
    }

    isStudentRegisteredForCourse(courseId, student) {
        if (!student) return false;
        const regs = this.getCourseRegistrations();
        const studentIdentifier = (student.sucCode || student.email || student.id || '').toLowerCase();
        return regs.some(r => 
            r.courseId === courseId && (
                (r.sucCode && r.sucCode.toLowerCase() === studentIdentifier) ||
                (r.email && r.email.toLowerCase() === studentIdentifier) ||
                (r.studentId && r.studentId === student.id)
            )
        );
    }

    registerCourse(regData) {
        const allRegs = this.getCourseRegistrations();
        const newReg = {
            id: 'reg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            courseId: regData.courseId,
            courseTitle: regData.courseTitle || '',
            studentId: regData.studentId || '',
            fullName: (regData.fullName || '').trim(),
            sucCode: (regData.sucCode || '').trim().toUpperCase(),
            collegeName: (regData.collegeName || '').trim(),
            email: (regData.email || '').trim().toLowerCase(),
            presentStudy: (regData.presentStudy || '').trim(),
            registeredAt: Date.now()
        };

        const existingIdx = allRegs.findIndex(r => r.courseId === newReg.courseId && (
            (r.sucCode && r.sucCode === newReg.sucCode) || 
            (r.email && r.email === newReg.email)
        ));

        if (existingIdx >= 0) {
            allRegs[existingIdx] = newReg;
        } else {
            allRegs.push(newReg);
        }

        this.registrations = allRegs;

        try {
            localStorage.setItem(STORAGE_KEYS.REGISTRATIONS, JSON.stringify(this.registrations));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveRegistrationToCloud(newReg);
        }

        const currentStudent = this.getCurrentStudent();
        if (currentStudent && (newReg.collegeName || newReg.presentStudy)) {
            currentStudent.collegeName = newReg.collegeName || currentStudent.collegeName || '';
            currentStudent.presentStudy = newReg.presentStudy || currentStudent.presentStudy || '';

            const allStudents = this.getStudents();
            const sIdx = allStudents.findIndex(s => s.id === currentStudent.id || s.sucCode === currentStudent.sucCode);
            if (sIdx >= 0) {
                allStudents[sIdx] = currentStudent;
                this.students = allStudents;
                try {
                    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));
                    localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(currentStudent));
                } catch (e) {}

                if (typeof window !== 'undefined' && window.UseasFirebase) {
                    window.UseasFirebase.saveStudentToCloud(currentStudent);
                }
            }
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('registrations-updated'));
        }

        return { success: true, registration: newReg };
    }

    resetToDefault() {
        this.getCourses().forEach(c => this.deletedCourseIds.add(c.id));
        this.courses = [];
        this.progress = {};
        this.registrations = [];

        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify([]));
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify({}));
            localStorage.setItem(STORAGE_KEYS.REGISTRATIONS, JSON.stringify([]));
        } catch (e) {}

        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.resetCoursesInCloud();
            window.UseasFirebase.syncProgressToCloud({});
            window.UseasFirebase.syncRegistrationsToCloud([]);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
            window.dispatchEvent(new CustomEvent('progress-updated'));
            window.dispatchEvent(new CustomEvent('registrations-updated'));
        }
    }
}

if (typeof window !== 'undefined') {
    window.UseasStore = new StoreManager();
}
