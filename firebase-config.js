/**
 * useas - Firebase App, Analytics & Realtime Database Configuration
 * Project: tff-aim-bot-v108
 * Complete Realtime Cloud Data Backend for GitHub Pages Deployment
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getDatabase, ref, set, onValue, remove, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

let app = null;
let analytics = null;
let db = null;

async function initFirebase() {
    try {
        const res = await fetch('/api/firebase-config');
        if (!res.ok) return null;
        const payload = await res.json();
        if (!payload || !payload.configured || !payload.config || !payload.config.apiKey) {
            console.info("Firebase not configured — running with LocalStorage persistence.");
            return null;
        }

        app = initializeApp(payload.config);
        try {
            if (payload.config.measurementId) {
                analytics = getAnalytics(app);
            }
        } catch (e) {
            console.log("Firebase Analytics initialization skipped or offline:", e);
        }

        if (payload.config.databaseURL) {
            db = getDatabase(app);
        }
        return db;
    } catch (err) {
        console.warn("Firebase config load failed — running with LocalStorage persistence:", err);
        return null;
    }
}

await initFirebase();

// Global Firebase Manager Window Export (only active when Firebase DB is configured)
window.UseasFirebase = db ? {
    app,
    analytics,
    db,
    isConnected: true,

    // Save or Update Admin Credentials & Profile
    async saveAdminProfileToCloud(adminProfile) {
        if (!adminProfile) return false;
        try {
            const clean = JSON.parse(JSON.stringify(adminProfile));
            await set(ref(db, 'admin_profile'), clean);
            return true;
        } catch (err) {
            console.error("Firebase saveAdminProfileToCloud error:", err);
            return false;
        }
    },

    listenAdminProfile(callback) {
        try {
            const adminRef = ref(db, 'admin_profile');
            onValue(adminRef, (snapshot) => {
                const data = snapshot.val();
                callback(data || null);
            }, (err) => {
                console.warn("Firebase admin profile listener warning:", err);
            });
        } catch (e) {
            console.warn("Could not attach Firebase admin profile listener:", e);
        }
    },

    // Save or Update Single Course Node
    async saveCourseToCloud(course) {
        if (!course || !course.id) return false;
        try {
            const clean = JSON.parse(JSON.stringify(course));
            await set(ref(db, `courses/${course.id}`), clean);
            return true;
        } catch (err) {
            console.error("Firebase saveCourseToCloud error:", err);
            return false;
        }
    },

    // Delete Single Course Node
    async deleteCourseFromCloud(courseId) {
        if (!courseId) return false;
        try {
            await remove(ref(db, `courses/${courseId}`));
            return true;
        } catch (err) {
            console.error("Firebase deleteCourseFromCloud error:", err);
            return false;
        }
    },

    // Bulk Sync / Seed Courses
    async syncCoursesToCloud(courses) {
        try {
            const cleanList = JSON.parse(JSON.stringify(courses || []));
            const updates = {};
            cleanList.forEach(c => {
                if (c && c.id) {
                    updates[`courses/${c.id}`] = c;
                }
            });
            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
            } else {
                await set(ref(db, 'courses'), []);
            }
            return true;
        } catch (err) {
            console.error("Firebase syncCoursesToCloud error:", err);
            return false;
        }
    },

    // Reset All Courses Node
    async resetCoursesInCloud() {
        try {
            await remove(ref(db, 'courses'));
            return true;
        } catch (err) {
            console.error("Firebase resetCoursesInCloud error:", err);
            return false;
        }
    },

    // Save Progress Item
    async saveProgressToCloud(key, progressData) {
        if (!key) return false;
        try {
            const clean = JSON.parse(JSON.stringify(progressData || {}));
            await set(ref(db, `progress/${key}`), clean);
            return true;
        } catch (err) {
            console.error("Firebase saveProgressToCloud error:", err);
            return false;
        }
    },

    // Bulk Sync Progress Map
    async syncProgressToCloud(progressMap) {
        try {
            const cleanProgress = JSON.parse(JSON.stringify(progressMap || {}));
            await set(ref(db, 'progress'), cleanProgress);
            return true;
        } catch (err) {
            console.error("Firebase DB sync error (progress):", err);
            return false;
        }
    },

    // Save Student Account Node
    async saveStudentToCloud(student) {
        if (!student || !student.id) return false;
        try {
            const clean = JSON.parse(JSON.stringify(student));
            await set(ref(db, `students/${student.id}`), clean);
            return true;
        } catch (err) {
            console.error("Firebase saveStudentToCloud error:", err);
            return false;
        }
    },

    // Bulk Sync Students List
    async syncStudentsToCloud(students) {
        try {
            const cleanStudents = JSON.parse(JSON.stringify(students || []));
            await set(ref(db, 'students'), cleanStudents);
            return true;
        } catch (err) {
            console.error("Firebase DB sync error (students):", err);
            return false;
        }
    },

    // Save Course Registration Node
    async saveRegistrationToCloud(registration) {
        if (!registration || !registration.id) return false;
        try {
            const clean = JSON.parse(JSON.stringify(registration));
            await set(ref(db, `registrations/${registration.id}`), clean);
            return true;
        } catch (err) {
            console.error("Firebase saveRegistrationToCloud error:", err);
            return false;
        }
    },

    // Bulk Sync Course Registrations
    async syncRegistrationsToCloud(registrations) {
        try {
            const cleanRegistrations = JSON.parse(JSON.stringify(registrations || []));
            await set(ref(db, 'registrations'), cleanRegistrations);
            return true;
        } catch (err) {
            console.error("Firebase DB sync error (registrations):", err);
            return false;
        }
    },

    // Realtime Listeners for Live Cloud Sync across all connected users
    listenCourses(callback) {
        try {
            const coursesRef = ref(db, 'courses');
            onValue(coursesRef, (snapshot) => {
                const data = snapshot.val();
                if (data !== null && data !== undefined) {
                    const coursesList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                    callback(coursesList);
                } else {
                    callback(null);
                }
            }, (err) => {
                console.warn("Firebase courses listener warning:", err);
            });
        } catch (e) {
            console.warn("Could not attach Firebase courses listener:", e);
        }
    },

    listenProgress(callback) {
        try {
            const progressRef = ref(db, 'progress');
            onValue(progressRef, (snapshot) => {
                const data = snapshot.val();
                callback(data || {});
            }, (err) => {
                console.warn("Firebase progress listener warning:", err);
            });
        } catch (e) {
            console.warn("Could not attach Firebase progress listener:", e);
        }
    },

    listenStudents(callback) {
        try {
            const studentsRef = ref(db, 'students');
            onValue(studentsRef, (snapshot) => {
                const data = snapshot.val();
                if (data !== null && data !== undefined) {
                    const studentsList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                    callback(studentsList);
                } else {
                    callback([]);
                }
            }, (err) => {
                console.warn("Firebase students listener warning:", err);
            });
        } catch (e) {
            console.warn("Could not attach Firebase students listener:", e);
        }
    },

    listenRegistrations(callback) {
        try {
            const regRef = ref(db, 'registrations');
            onValue(regRef, (snapshot) => {
                const data = snapshot.val();
                if (data !== null && data !== undefined) {
                    const regList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                    callback(regList);
                } else {
                    callback([]);
                }
            }, (err) => {
                console.warn("Firebase registrations listener warning:", err);
            });
        } catch (e) {
            console.warn("Could not attach Firebase registrations listener:", e);
        }
    }
} : null;

// Dispatch Event so Store & Apps know Firebase is initialized
if (window.UseasFirebase) {
    window.dispatchEvent(new CustomEvent('firebase-ready'));
}
