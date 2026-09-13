/**
 * useas - Data Store & State Management Module
 * Manages courses, lessons, YouTube video URL parsing, completion progress, and Firebase sync.
 * Implements Production Realtime Database Backend (Child Node RTDB Sync) for GitHub Pages Deployment.
 */

const STORAGE_KEYS = {
    COURSES: 'useas_courses_v1',
    PROGRESS: 'useas_progress_v1',
    STUDENTS: 'useas_students_v1',
    CURRENT_STUDENT: 'useas_current_student_v1',
    REGISTRATIONS: 'useas_registrations_v1'
};

// Default Courses initialized with multi-type lessons (Video, Text Page, Proctored Exam)
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
                textContent: `### Modern Web Architecture Overview\n\nModern frontend web applications rely on key principles:\n\n1. **Component-Driven Architecture**: Building user interfaces using small, isolated, and reusable component blocks.\n2. **Declarative State Management**: Keeping state localized or central while automatically re-rendering target DOM trees.\n3. **Single Page Applications (SPAs)**: Routing client-side without full page reloads to maximize user experience speed.`
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
        this.hasSeededDefaults = false;

        this.initStore();
        this.setupFirebaseSync();
    }

    initStore() {
        try {
            // Load Courses from localStorage
            const savedCourses = localStorage.getItem(STORAGE_KEYS.COURSES);
            if (savedCourses) {
                const parsed = JSON.parse(savedCourses);
                this.courses = Array.isArray(parsed) ? parsed.filter(c => c && typeof c === 'object' && c.id) : DEFAULT_COURSES;
            } else {
                this.courses = DEFAULT_COURSES;
                localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(DEFAULT_COURSES));
            }

            // Load Progress
            const savedProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS);
            this.progress = savedProgress ? JSON.parse(savedProgress) : {};

            // Load Students
            const savedStudents = localStorage.getItem(STORAGE_KEYS.STUDENTS);
            this.students = savedStudents ? JSON.parse(savedStudents) : [];

            // Load Current Student
            const savedCurrentStudent = localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT);
            this.currentStudent = savedCurrentStudent ? JSON.parse(savedCurrentStudent) : null;

            // Load Registrations
            const savedRegistrations = localStorage.getItem(STORAGE_KEYS.REGISTRATIONS);
            this.registrations = savedRegistrations ? JSON.parse(savedRegistrations) : [];
        } catch (e) {
            console.error('Store initialization error, fallback to defaults:', e);
            this.courses = DEFAULT_COURSES;
            this.progress = {};
            this.students = [];
            this.currentStudent = null;
            this.registrations = [];
        }
    }

    setupFirebaseSync() {
        const attachListeners = () => {
            if (typeof window !== 'undefined' && window.UseasFirebase) {
                // Firebase Realtime Listener: Courses
                window.UseasFirebase.listenCourses((cloudCourses) => {
                    if (cloudCourses === null) {
                        // Firebase DB /courses is empty (first deployment) -> seed DEFAULT_COURSES once
                        if (!this.hasSeededDefaults) {
                            this.hasSeededDefaults = true;
                            this.courses = DEFAULT_COURSES;
                            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(DEFAULT_COURSES));
                            window.UseasFirebase.syncCoursesToCloud(DEFAULT_COURSES);
                        }
                    } else if (Array.isArray(cloudCourses)) {
                        const validCloud = cloudCourses.filter(c => c && typeof c === 'object' && c.id);
                        if (validCloud.length > 0) {
                            this.courses = validCloud;
                            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
                        }
                    }

                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('courses-updated'));
                    }
                });

                // Firebase Realtime Listener: Progress
                window.UseasFirebase.listenProgress((cloudProgress) => {
                    if (cloudProgress && typeof cloudProgress === 'object') {
                        this.progress = { ...this.progress, ...cloudProgress };
                        localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('progress-updated'));
                        }
                    }
                });

                // Firebase Realtime Listener: Students
                window.UseasFirebase.listenStudents((cloudStudents) => {
                    if (cloudStudents && Array.isArray(cloudStudents) && cloudStudents.length > 0) {
                        const validStudents = cloudStudents.filter(s => s && typeof s === 'object' && (s.id || s.sucCode));
                        if (validStudents.length > 0) {
                            this.students = validStudents;
                            localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));

                            if (this.currentStudent) {
                                const updated = this.students.find(s => s.id === this.currentStudent.id || (s.sucCode && s.sucCode.toLowerCase() === this.currentStudent.sucCode.toLowerCase()));
                                if (updated) {
                                    this.currentStudent = updated;
                                    localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(updated));
                                }
                            }

                            if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('student-auth-changed'));
                            }
                        }
                    }
                });

                // Firebase Realtime Listener: Registrations
                window.UseasFirebase.listenRegistrations((cloudRegistrations) => {
                    if (cloudRegistrations && Array.isArray(cloudRegistrations) && cloudRegistrations.length > 0) {
                        const validRegs = cloudRegistrations.filter(r => r && typeof r === 'object');
                        this.registrations = validRegs;
                        localStorage.setItem(STORAGE_KEYS.REGISTRATIONS, JSON.stringify(this.registrations));
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('registrations-updated'));
                        }
                    }
                });
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('firebase-ready', attachListeners);
            if (window.UseasFirebase) attachListeners();
        }
    }

    // Helper: Extract YouTube Video ID from any URL format cleanly (watch, shorts, embed, youtu.be, etc.)
    extractYoutubeId(urlOrId) {
        if (!urlOrId) return '';
        const trimmed = urlOrId.trim();
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
            return trimmed;
        }
        const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) {
            return match[1];
        }
        const fallback = trimmed.match(/([a-zA-Z0-9_-]{11})/);
        return fallback ? fallback[1] : trimmed;
    }

    // Get all courses
    getCourses() {
        if (!this.courses || this.courses.length === 0) {
            try {
                const saved = localStorage.getItem(STORAGE_KEYS.COURSES);
                if (saved) this.courses = JSON.parse(saved);
            } catch (e) {}
        }
        return (this.courses || []).filter(c => c && typeof c === 'object' && c.id);
    }

    // Get single course by ID
    getCourseById(courseId) {
        return (this.getCourses()).find(c => c.id === courseId) || null;
    }

    // Save or update a course (Instant Local + Direct Firebase Node Save)
    saveCourse(courseData) {
        if (!this.courses) this.courses = [];
        const existingIndex = this.courses.findIndex(c => c && c.id === courseData.id);
        
        let targetCourse;
        if (existingIndex >= 0) {
            this.courses[existingIndex] = {
                lessons: [],
                ...this.courses[existingIndex],
                ...courseData
            };
            targetCourse = this.courses[existingIndex];
        } else {
            targetCourse = {
                id: courseData.id || ('course-' + Date.now()),
                lessons: [],
                ...courseData
            };
            this.courses.unshift(targetCourse);
        }

        // Clean array
        this.courses = this.courses.filter(c => c && typeof c === 'object' && c.id);

        // Save to local cache
        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {}

        // Firebase Cloud Push (Specific Course Node Push)
        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(targetCourse);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return true;
    }

    // Delete a course
    deleteCourse(courseId) {
        this.courses = (this.courses || []).filter(c => c && c.id !== courseId);
        
        // Clean up progress for this course
        if (this.progress[courseId]) {
            delete this.progress[courseId];
        }

        // Save to local cache
        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(this.progress));
        } catch (e) {}

        // Delete from Firebase Cloud Node
        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.deleteCourseFromCloud(courseId);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
            window.dispatchEvent(new CustomEvent('progress-updated'));
        }
    }

    // Add or update lesson in a course
    saveLesson(courseId, lessonData) {
        const course = (this.getCourses()).find(c => c.id === courseId);
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

        // Save local cache
        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {}

        // Save parent course node to Firebase Cloud
        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(course);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return lessonPayload;
    }

    // Delete a lesson from a course
    deleteLesson(courseId, lessonId) {
        const course = (this.getCourses()).find(c => c.id === courseId);
        if (!course) return false;

        course.lessons = (course.lessons || []).filter(l => l && l.id !== lessonId);

        // Clean from completion progress
        this.toggleLessonComplete(courseId, lessonId, false);

        // Save local cache
        try {
            localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(this.courses));
        } catch (e) {}

        // Save updated parent course node to Firebase Cloud
        if (typeof window !== 'undefined' && window.UseasFirebase) {
            window.UseasFirebase.saveCourseToCloud(course);
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('courses-updated'));
        }
        return true;
    }

    // Progress Engine Methods
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

        let newState;
        if (forceState !== null) {
            newState = forceState;
        } else {
            newState = !isAlreadyComplete;
        }

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

    // Student Authentication Methods
    getStudents() {
        return this.students || [];
    }

    getCurrentStudent() {
        return this.currentStudent;
    }

    registerStudent({ fullName, sucCode, email, password }) {
        const normSuc = sucCode.trim().toLowerCase();
        const normEmail = email.trim().toLowerCase();

        // Check uniqueness
        const sucExists = (this.students || []).some(s => s.sucCode && s.sucCode.toLowerCase() === normSuc);
        if (sucExists) {
            return { error: 'This Student SUC Code is already registered. Please log in.' };
        }
        const emailExists = (this.students || []).some(s => s.email && s.email.toLowerCase() === normEmail);
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

        this.students.push(newStudent);
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
        const normId = identifier.trim().toLowerCase();

        const found = (this.students || []).find(s => 
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

    logoutStudent() {
        this.currentStudent = null;
        try {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT);
        } catch (e) {}

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('student-auth-changed'));
        }
    }

    // Course Registration Methods
    getCourseRegistrations() {
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

        const existingIdx = (this.registrations || []).findIndex(r => r.courseId === newReg.courseId && (
            (r.sucCode && r.sucCode === newReg.sucCode) || 
            (r.email && r.email === newReg.email)
        ));

        if (existingIdx >= 0) {
            this.registrations[existingIdx] = newReg;
        } else {
            this.registrations.push(newReg);
        }

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

            const sIdx = this.students.findIndex(s => s.id === currentStudent.id || s.sucCode === currentStudent.sucCode);
            if (sIdx >= 0) {
                this.students[sIdx] = currentStudent;
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

// Global Store Instance
if (typeof window !== 'undefined') {
    window.UseasStore = new StoreManager();
}
