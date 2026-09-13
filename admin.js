/**
 * useas - Admin Portal Application Script (admin.js)
 * Handles course CRUD operations, YouTube video lesson additions, video previews, & dashboard stats.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Dashboard Stats Elements
    const statTotalCourses = document.getElementById('statTotalCourses');
    const statTotalLessons = document.getElementById('statTotalLessons');
    const statTotalCategories = document.getElementById('statTotalCategories');
    const statTotalRegistrations = document.getElementById('statTotalRegistrations');
    const adminCoursesTableBody = document.getElementById('adminCoursesTableBody');
    const adminRegistrationsTableBody = document.getElementById('adminRegistrationsTableBody');
    const adminRegSearchInput = document.getElementById('adminRegSearchInput');

    // Buttons
    const openAddCourseBtn = document.getElementById('openAddCourseBtn');
    const resetDemoBtn = document.getElementById('resetDemoBtn');

    // Course Modal Elements
    const courseModal = document.getElementById('courseModal');
    const courseModalTitle = document.getElementById('courseModalTitle');
    const closeCourseModalBtn = document.getElementById('closeCourseModalBtn');
    const cancelCourseBtn = document.getElementById('cancelCourseBtn');
    const courseForm = document.getElementById('courseForm');
    const courseIdInput = document.getElementById('courseIdInput');
    const courseTitleInput = document.getElementById('courseTitleInput');
    const courseCategoryInput = document.getElementById('courseCategoryInput');
    const courseLevelInput = document.getElementById('courseLevelInput');
    const courseThumbInput = document.getElementById('courseThumbInput');
    const courseDescInput = document.getElementById('courseDescInput');

    // Lessons Modal Elements
    const lessonsModal = document.getElementById('lessonsModal');
    const manageCourseTitle = document.getElementById('manageCourseTitle');
    const manageCourseCategory = document.getElementById('manageCourseCategory');
    const closeLessonsModalBtn = document.getElementById('closeLessonsModalBtn');
    const lessonForm = document.getElementById('lessonForm');
    const lessonIdInput = document.getElementById('lessonIdInput');
    const lessonTitleInput = document.getElementById('lessonTitleInput');
    const lessonUrlInput = document.getElementById('lessonUrlInput');
    const lessonDurationInput = document.getElementById('lessonDurationInput');
    const lessonDescInput = document.getElementById('lessonDescInput');
    const previewBtn = document.getElementById('previewBtn');
    const videoPreviewWrap = document.getElementById('videoPreviewWrap');
    const previewIframe = document.getElementById('previewIframe');
    const lessonsTableContainer = document.getElementById('lessonsTableContainer');

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    // State
    let activeManagingCourseId = null;
    let regSearchQuery = '';

    // Initialize Admin Console
    initAdmin();

    function initAdmin() {
        renderAdminDashboard();
        renderAdminRegistrations();
        setupAdminEventListeners();

        // Listen for live Firebase cloud sync & storage updates
        window.addEventListener('courses-updated', () => renderAdminDashboard());
        window.addEventListener('registrations-updated', () => renderAdminRegistrations());
        window.addEventListener('storage', (e) => {
            if (e.key === 'useas_courses_v1') renderAdminDashboard();
            if (e.key === 'useas_registrations_v1') renderAdminRegistrations();
        });

        if (adminRegSearchInput) {
            adminRegSearchInput.addEventListener('input', (e) => {
                regSearchQuery = e.target.value.toLowerCase().trim();
                renderAdminRegistrations();
            });
        }
    }

    function setupAdminEventListeners() {
        // Add Course Button
        if (openAddCourseBtn) {
            openAddCourseBtn.addEventListener('click', openAddCourseModal);
        }

        // Reset / Clear Courses Button
        if (resetDemoBtn) {
            resetDemoBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all courses from Firebase Realtime Database?')) {
                    window.UseasStore.resetToDefault();
                    renderAdminDashboard();
                    showToast('All courses cleared.', 'danger');
                }
            });
        }

        // Course Modal Close
        if (closeCourseModalBtn) closeCourseModalBtn.addEventListener('click', closeCourseModal);
        if (cancelCourseBtn) cancelCourseBtn.addEventListener('click', closeCourseModal);

        if (courseModal) {
            courseModal.addEventListener('click', (e) => {
                if (e.target === courseModal) closeCourseModal();
            });
        }

        // Course Form Submit
        if (courseForm) {
            courseForm.addEventListener('submit', handleCourseSubmit);
        }

        // Lessons Modal Close
        if (closeLessonsModalBtn) {
            closeLessonsModalBtn.addEventListener('click', closeLessonsModal);
        }

        if (lessonsModal) {
            lessonsModal.addEventListener('click', (e) => {
                if (e.target === lessonsModal) closeLessonsModal();
            });
        }

        // Keyboard ESC Listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeCourseModal();
                closeLessonsModal();
            }
        });

        // Lesson Form Submit
        if (lessonForm) {
            lessonForm.addEventListener('submit', handleLessonSubmit);
        }

        // Video Preview Button
        if (previewBtn) {
            previewBtn.addEventListener('click', handleVideoPreview);
        }

        // Event Delegation for Table Action Buttons
        if (adminCoursesTableBody) {
            adminCoursesTableBody.addEventListener('click', (e) => {
                const manageBtn = e.target.closest('.manage-lessons-btn');
                if (manageBtn) {
                    const courseId = manageBtn.getAttribute('data-id');
                    openManageVideosModal(courseId);
                    return;
                }

                const editBtn = e.target.closest('.edit-course-btn');
                if (editBtn) {
                    const courseId = editBtn.getAttribute('data-id');
                    openEditCourseModal(courseId);
                    return;
                }

                const deleteBtn = e.target.closest('.delete-course-btn');
                if (deleteBtn) {
                    const courseId = deleteBtn.getAttribute('data-id');
                    handleCourseDelete(courseId);
                    return;
                }
            });
        }
    }

    // Render Dashboard Table and Stats
    function renderAdminDashboard() {
        const courses = (window.UseasStore.getCourses() || []).filter(c => c && c.id);

        // Calculate Stats
        const totalCourses = courses.length;
        let totalLessons = 0;
        const categoriesSet = new Set();

        courses.forEach(c => {
            if (c.lessons) totalLessons += c.lessons.length;
            if (c.category) categoriesSet.add(c.category);
        });

        if (statTotalCourses) statTotalCourses.textContent = totalCourses;
        if (statTotalLessons) statTotalLessons.textContent = totalLessons;
        if (statTotalCategories) statTotalCategories.textContent = categoriesSet.size;

        // Render Table
        if (!adminCoursesTableBody) return;

        if (courses.length === 0) {
            adminCoursesTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state" style="padding: 2rem;">
                        <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
                        <p>No courses found. Click "+ Add New Course" to get started.</p>
                    </td>
                </tr>
            `;
            return;
        }

        adminCoursesTableBody.innerHTML = courses.map(course => {
            const lessonCount = course.lessons ? course.lessons.length : 0;

            return `
                <tr>
                    <td>
                        <img src="${course.thumbnail}" alt="${course.title}" class="table-thumb" onerror="this.src='https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80'">
                    </td>
                    <td>
                        <strong style="color: var(--text-main); font-weight: 600;">${course.title}</strong>
                        <div style="font-size: 0.78rem; color: var(--text-dim); text-overflow: ellipsis; overflow: hidden; max-width: 280px; white-space: nowrap;">
                            ${course.description}
                        </div>
                    </td>
                    <td>
                        <span class="badge-category" style="position: static;">${course.category || 'General'}</span>
                    </td>
                    <td><span style="color: var(--text-muted);">${course.level || 'All Levels'}</span></td>
                    <td>
                        <span class="btn-sm" style="background: rgba(99, 102, 241, 0.1); color: var(--primary-dark); border: 1px solid rgba(99, 102, 241, 0.2);">
                            <i class="fa-solid fa-video"></i> ${lessonCount} Videos
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.4rem;">
                            <button class="btn btn-secondary btn-sm manage-lessons-btn" data-id="${course.id}" title="Add/Edit YouTube Videos">
                                <i class="fa-solid fa-list-check"></i> Videos
                            </button>
                            <button class="btn btn-secondary btn-sm edit-course-btn" data-id="${course.id}" title="Edit Course Details">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="btn btn-danger btn-sm delete-course-btn" data-id="${course.id}" title="Delete Course">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Student Registrations Table in Admin Console
    function renderAdminRegistrations() {
        const regs = window.UseasStore.getCourseRegistrations();

        if (statTotalRegistrations) {
            statTotalRegistrations.textContent = regs.length;
        }

        if (!adminRegistrationsTableBody) return;

        const filteredRegs = regs.filter(r => {
            if (!regSearchQuery) return true;
            return (r.fullName || '').toLowerCase().includes(regSearchQuery) ||
                   (r.sucCode || '').toLowerCase().includes(regSearchQuery) ||
                   (r.collegeName || '').toLowerCase().includes(regSearchQuery) ||
                   (r.email || '').toLowerCase().includes(regSearchQuery) ||
                   (r.presentStudy || '').toLowerCase().includes(regSearchQuery) ||
                   (r.courseTitle || '').toLowerCase().includes(regSearchQuery);
        });

        if (filteredRegs.length === 0) {
            adminRegistrationsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state" style="padding: 2rem; text-align: center;">
                        <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; color: var(--text-dim);"></i>
                        <p>No student course registrations found.</p>
                    </td>
                </tr>
            `;
            return;
        }

        adminRegistrationsTableBody.innerHTML = filteredRegs.map(reg => {
            const dateStr = reg.registeredAt ? new Date(reg.registeredAt).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'N/A';

            return `
                <tr>
                    <td>
                        <strong style="color: var(--text-main); font-weight: 700;">${reg.fullName || 'N/A'}</strong>
                    </td>
                    <td>
                        <span style="background: rgba(99, 102, 241, 0.12); color: var(--primary-dark); font-weight: 700; padding: 0.25rem 0.65rem; border-radius: var(--radius-full); font-size: 0.82rem;">
                            ${reg.sucCode || 'N/A'}
                        </span>
                    </td>
                    <td>${reg.collegeName || 'N/A'}</td>
                    <td><a href="mailto:${reg.email}" style="color: var(--primary); font-weight: 600; text-decoration: none;">${reg.email || 'N/A'}</a></td>
                    <td><span style="font-size: 0.85rem; color: var(--text-muted);">${reg.presentStudy || 'N/A'}</span></td>
                    <td>
                        <strong style="color: var(--primary-dark);">${reg.courseTitle || 'Course'}</strong>
                    </td>
                    <td style="font-size: 0.8rem; color: var(--text-dim);">${dateStr}</td>
                </tr>
            `;
        }).join('');
    }

    // Add / Edit Course Modal Logic
    function openAddCourseModal() {
        courseForm.reset();
        courseIdInput.value = '';
        const initialVideoGroup = document.getElementById('initialVideoGroup');
        const initialVideoUrlInput = document.getElementById('initialVideoUrlInput');
        if (initialVideoGroup) initialVideoGroup.style.display = 'block';
        if (initialVideoUrlInput) initialVideoUrlInput.value = '';

        courseModalTitle.textContent = 'Add New Course';
        courseModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function openEditCourseModal(courseId) {
        const course = window.UseasStore.getCourseById(courseId);
        if (!course) return;

        courseIdInput.value = course.id;
        courseTitleInput.value = course.title || '';
        courseCategoryInput.value = course.category || '';
        courseLevelInput.value = course.level || 'All Levels';
        courseThumbInput.value = course.thumbnail || '';
        courseDescInput.value = course.description || '';

        const initialVideoGroup = document.getElementById('initialVideoGroup');
        if (initialVideoGroup) initialVideoGroup.style.display = 'none';

        courseModalTitle.textContent = 'Edit Course Details';
        courseModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeCourseModal() {
        courseModal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    function handleCourseSubmit(e) {
        e.preventDefault();

        const isNewCourse = !courseIdInput.value;
        const targetCourseId = courseIdInput.value || ('course-' + Date.now());
        const initialVideoUrlInput = document.getElementById('initialVideoUrlInput');
        const initialVideoUrl = initialVideoUrlInput ? initialVideoUrlInput.value.trim() : '';

        const coursePayload = {
            id: targetCourseId,
            title: courseTitleInput.value.trim(),
            category: courseCategoryInput.value.trim(),
            level: courseLevelInput.value,
            thumbnail: courseThumbInput.value.trim() || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80',
            description: courseDescInput.value.trim()
        };

        window.UseasStore.saveCourse(coursePayload);

        // If an initial video URL was provided, add it as lesson #1
        if (isNewCourse && initialVideoUrl) {
            window.UseasStore.saveLesson(targetCourseId, {
                title: '1. ' + coursePayload.title + ' Overview',
                videoUrl: initialVideoUrl,
                duration: '10 mins',
                description: 'Initial video lesson.'
            });
        }

        closeCourseModal();
        renderAdminDashboard();

        if (isNewCourse) {
            showToast('Course created! Opening Video Manager...', 'success');
            setTimeout(() => {
                openManageVideosModal(targetCourseId);
            }, 300);
        } else {
            showToast('Course details saved successfully!', 'success');
        }
    }

    function handleCourseDelete(courseId) {
        const course = window.UseasStore.getCourseById(courseId);
        if (!course) return;

        if (confirm(`Are you sure you want to delete "${course.title}"? This cannot be undone.`)) {
            window.UseasStore.deleteCourse(courseId);
            renderAdminDashboard();
            showToast('Course deleted.', 'danger');
        }
    }

    // Lesson Type Tabs & Dynamic Inputs
    let currentLessonType = 'video';
    let currentExamQuestions = [];

    const typeButtons = document.querySelectorAll('.lesson-type-btn');
    const videoGroup = document.getElementById('videoFieldsGroup');
    const textGroup = document.getElementById('textFieldsGroup');
    const examGroup = document.getElementById('examFieldsGroup');
    const lessonTypeInput = document.getElementById('lessonTypeInput');
    const lessonTextInput = document.getElementById('lessonTextInput');
    const examInstructionsInput = document.getElementById('examInstructionsInput');
    const addQuestionBtn = document.getElementById('addQuestionBtn');
    const questionsContainer = document.getElementById('questionsContainer');

    function setLessonType(type) {
        currentLessonType = type || 'video';
        if (lessonTypeInput) lessonTypeInput.value = currentLessonType;

        typeButtons.forEach(btn => {
            if (btn.getAttribute('data-type') === currentLessonType) {
                btn.classList.add('active');
                btn.style.background = 'var(--primary)';
                btn.style.color = '#fff';
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-main)';
            }
        });

        if (videoGroup) videoGroup.style.display = (currentLessonType === 'video') ? 'block' : 'none';
        if (textGroup) textGroup.style.display = (currentLessonType === 'text') ? 'block' : 'none';
        if (examGroup) examGroup.style.display = (currentLessonType === 'test') ? 'block' : 'none';
        if (previewBtn) previewBtn.style.display = (currentLessonType === 'video') ? 'inline-flex' : 'none';
    }

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setLessonType(btn.getAttribute('data-type'));
        });
    });

    if (addQuestionBtn) {
        addQuestionBtn.addEventListener('click', () => {
            currentExamQuestions.push({
                id: 'q-' + Date.now() + '-' + Math.floor(Math.random()*100),
                question: '',
                options: ['', '', '', ''],
                correctAnswer: 0
            });
            renderQuestionsBuilder();
        });
    }

    function renderQuestionsBuilder() {
        if (!questionsContainer) return;
        if (currentExamQuestions.length === 0) {
            questionsContainer.innerHTML = `
                <div style="font-size: 0.82rem; color: var(--text-dim); text-align: center; padding: 0.75rem;">
                    No questions added yet. Click "+ Add Question" to create test questions.
                </div>
            `;
            return;
        }

        questionsContainer.innerHTML = currentExamQuestions.map((q, idx) => `
            <div style="background: #fff; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.85rem; font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <strong style="color: var(--primary-dark);">Question ${idx + 1}</strong>
                    <button type="button" class="btn btn-danger btn-sm remove-q-btn" data-q-idx="${idx}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <input type="text" class="form-control q-title-input" data-q-idx="${idx}" placeholder="Enter question prompt..." value="${q.question || ''}" style="margin-bottom: 0.5rem; font-size: 0.85rem;">
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
                    ${[0, 1, 2, 3].map(optIdx => `
                        <div style="display: flex; align-items: center; gap: 0.3rem;">
                            <input type="radio" name="correct_q_${idx}" data-q-idx="${idx}" value="${optIdx}" ${q.correctAnswer === optIdx ? 'checked' : ''}>
                            <input type="text" class="form-control q-opt-input" data-q-idx="${idx}" data-opt-idx="${optIdx}" placeholder="Option ${String.fromCharCode(65 + optIdx)}" value="${(q.options && q.options[optIdx]) || ''}" style="font-size: 0.8rem; padding: 0.25rem 0.5rem;">
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        questionsContainer.querySelectorAll('.q-title-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.getAttribute('data-q-idx'), 10);
                if (currentExamQuestions[idx]) currentExamQuestions[idx].question = e.target.value;
            });
        });

        questionsContainer.querySelectorAll('.q-opt-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.getAttribute('data-q-idx'), 10);
                const optIdx = parseInt(e.target.getAttribute('data-opt-idx'), 10);
                if (currentExamQuestions[idx]) {
                    if (!currentExamQuestions[idx].options) currentExamQuestions[idx].options = ['', '', '', ''];
                    currentExamQuestions[idx].options[optIdx] = e.target.value;
                }
            });
        });

        questionsContainer.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const idx = parseInt(e.target.getAttribute('data-q-idx'), 10);
                const val = parseInt(e.target.value, 10);
                if (currentExamQuestions[idx]) currentExamQuestions[idx].correctAnswer = val;
            });
        });

        questionsContainer.querySelectorAll('.remove-q-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-q-idx'), 10);
                currentExamQuestions.splice(idx, 1);
                renderQuestionsBuilder();
            });
        });
    }

    // Manage Videos / Lessons Modal Logic
    function openManageVideosModal(courseId) {
        activeManagingCourseId = courseId;
        const course = window.UseasStore.getCourseById(courseId);
        if (!course) return;

        manageCourseTitle.textContent = course.title;
        manageCourseCategory.textContent = course.category || 'General';

        // Reset Form
        lessonForm.reset();
        lessonIdInput.value = '';
        currentExamQuestions = [];
        setLessonType('video');
        renderQuestionsBuilder();

        if (videoPreviewWrap) videoPreviewWrap.style.display = 'none';
        if (previewIframe) previewIframe.src = '';

        renderLessonsTable(course);
        lessonsModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLessonsModal() {
        lessonsModal.classList.remove('active');
        if (previewIframe) previewIframe.src = '';
        activeManagingCourseId = null;
        document.body.style.overflow = 'auto';
        renderAdminDashboard(); // Refresh stats
    }

    function renderLessonsTable(course) {
        if (!lessonsTableContainer) return;

        const lessons = course.lessons || [];

        if (lessons.length === 0) {
            lessonsTableContainer.innerHTML = `
                <div style="text-align: center; padding: 1.5rem; color: var(--text-dim); background: rgba(99,102,241,0.03); border-radius: var(--radius-md);">
                    No content steps added to this course yet. Use the form above to add your first lesson step!
                </div>
            `;
            return;
        }

        lessonsTableContainer.innerHTML = `
            <table class="custom-table" style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Step Title</th>
                        <th>Type</th>
                        <th>Content / Details</th>
                        <th>Duration</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${lessons.map((les, idx) => {
                        const type = les.type || 'video';
                        let typeBadge = '';
                        let detailsHtml = '';

                        if (type === 'video') {
                            typeBadge = `<span style="background: rgba(2,132,199,0.12); color: var(--accent-cyan); font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;"><i class="fa-solid fa-video"></i> Video</span>`;
                            detailsHtml = `<code style="color: var(--primary-dark); background: rgba(99,102,241,0.1); padding: 0.15rem 0.4rem; border-radius: 4px;">ID: ${les.videoId || 'N/A'}</code>`;
                        } else if (type === 'text') {
                            typeBadge = `<span style="background: rgba(16,185,129,0.12); color: var(--accent-green); font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;"><i class="fa-solid fa-file-lines"></i> Article</span>`;
                            detailsHtml = `<span style="color: var(--text-muted); font-size:0.8rem;">Text Page (${(les.textContent || '').length} chars)</span>`;
                        } else if (type === 'test') {
                            const qCount = (les.examData && les.examData.questions) ? les.examData.questions.length : 0;
                            typeBadge = `<span style="background: rgba(168,85,247,0.12); color: var(--secondary); font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;"><i class="fa-solid fa-clipboard-check"></i> Proctored Exam</span>`;
                            detailsHtml = `<span style="color: var(--secondary); font-weight:600; font-size:0.8rem;">${qCount} Questions (Cam/Mic Required)</span>`;
                        }

                        return `
                            <tr>
                                <td><strong>Step ${idx + 1}</strong></td>
                                <td>
                                    <strong style="color: var(--text-main);">${les.title}</strong>
                                </td>
                                <td>${typeBadge}</td>
                                <td>${detailsHtml}</td>
                                <td>${les.duration || 'N/A'}</td>
                                <td>
                                    <div style="display: flex; gap: 0.3rem;">
                                        <button class="btn btn-secondary btn-sm edit-lesson-btn" data-lesson-id="${les.id}" title="Edit Lesson Step">
                                            <i class="fa-solid fa-pen"></i>
                                        </button>
                                        <button class="btn btn-danger btn-sm delete-lesson-btn" data-lesson-id="${les.id}" title="Delete Lesson Step">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // Delegation handler for lessons table
    if (lessonsTableContainer) {
        lessonsTableContainer.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-lesson-btn');
            if (editBtn) {
                const lessonId = editBtn.getAttribute('data-lesson-id');
                const course = window.UseasStore.getCourseById(activeManagingCourseId);
                const lesson = course && (course.lessons || []).find(l => l.id === lessonId);
                if (lesson) {
                    lessonIdInput.value = lesson.id;
                    lessonTitleInput.value = lesson.title || '';
                    lessonDurationInput.value = lesson.duration || '';
                    lessonDescInput.value = lesson.description || '';
                    
                    const type = lesson.type || 'video';
                    setLessonType(type);

                    if (type === 'video') {
                        lessonUrlInput.value = lesson.videoUrl || lesson.videoId || '';
                        if (previewBtn) previewBtn.click();
                    } else if (type === 'text') {
                        if (lessonTextInput) lessonTextInput.value = lesson.textContent || '';
                    } else if (type === 'test') {
                        if (examInstructionsInput) examInstructionsInput.value = (lesson.examData && lesson.examData.instructions) || '';
                        currentExamQuestions = (lesson.examData && lesson.examData.questions) ? JSON.parse(JSON.stringify(lesson.examData.questions)) : [];
                        renderQuestionsBuilder();
                    }
                }
                return;
            }

            const deleteBtn = e.target.closest('.delete-lesson-btn');
            if (deleteBtn) {
                const lessonId = deleteBtn.getAttribute('data-lesson-id');
                window.UseasStore.deleteLesson(activeManagingCourseId, lessonId);
                const updatedCourse = window.UseasStore.getCourseById(activeManagingCourseId);
                renderLessonsTable(updatedCourse);
                showToast('Lesson step removed.', 'danger');
                return;
            }
        });
    }

    function handleLessonSubmit(e) {
        e.preventDefault();
        if (!activeManagingCourseId) return;

        const type = currentLessonType || 'video';
        const isEditing = Boolean(lessonIdInput.value);

        let lessonPayload = {
            id: lessonIdInput.value || undefined,
            type: type,
            title: lessonTitleInput.value.trim(),
            duration: lessonDurationInput.value.trim() || '10 mins',
            description: lessonDescInput.value.trim()
        };

        if (type === 'video') {
            const videoUrl = lessonUrlInput.value.trim();
            const extractedId = window.UseasStore.extractYoutubeId(videoUrl);
            if (!extractedId) {
                showToast('Please enter a valid YouTube URL or Video ID.', 'danger');
                return;
            }
            lessonPayload.videoUrl = videoUrl;
            lessonPayload.videoId = extractedId;
        } else if (type === 'text') {
            const textContent = lessonTextInput ? lessonTextInput.value.trim() : '';
            if (!textContent) {
                showToast('Please enter article content for text page.', 'danger');
                return;
            }
            lessonPayload.textContent = textContent;
        } else if (type === 'test') {
            const instructions = examInstructionsInput ? examInstructionsInput.value.trim() : '';
            lessonPayload.examData = {
                durationMins: parseInt(lessonPayload.duration, 10) || 15,
                passPercentage: 60,
                instructions: instructions || 'No cheating allowed. Camera & microphone MUST be on. Switching tabs is strictly monitored.',
                questions: currentExamQuestions
            };
        }

        window.UseasStore.saveLesson(activeManagingCourseId, lessonPayload);
        
        lessonForm.reset();
        lessonIdInput.value = '';
        currentExamQuestions = [];
        setLessonType('video');
        renderQuestionsBuilder();

        if (videoPreviewWrap) videoPreviewWrap.style.display = 'none';

        const updatedCourse = window.UseasStore.getCourseById(activeManagingCourseId);
        renderLessonsTable(updatedCourse);
        showToast(isEditing ? 'Lesson step updated!' : 'New lesson step added to course!', 'success');
    }

    function handleVideoPreview() {
        const videoUrl = lessonUrlInput.value.trim();
        const videoId = window.UseasStore.extractYoutubeId(videoUrl);

        if (!videoId) {
            alert('Please enter a YouTube video URL or ID first.');
            return;
        }

        previewIframe.src = `https://www.youtube.com/embed/${videoId}`;
        videoPreviewWrap.style.display = 'block';
    }

    // Helper: Toast Notifications
    function showToast(message, type = 'info') {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        
        const icon = type === 'success' ? 'fa-circle-check' : (type === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-info');
        const color = type === 'success' ? 'var(--accent-green)' : (type === 'danger' ? 'var(--accent-red)' : 'var(--primary-dark)');

        toast.innerHTML = `
            <i class="fa-solid ${icon}" style="color: ${color}; font-size: 1.1rem;"></i>
            <span>${message}</span>
        `;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});
