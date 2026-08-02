"""审计日志人类可读标签：统一「学生·作业名·班级·学校」格式，不再出现 #ID。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assignment import Assignment
from app.models.course import Course
from app.models.school import School
from app.models.school_class import Class, class_students
from app.models.submission import Submission
from app.models.user import User


async def _first(db: AsyncSession, stmt):
    return (await db.execute(stmt)).scalars().first()


async def build_submission_label(
    db: AsyncSession, submission: Submission, assignment: Assignment = None
) -> str:
    """把一条提交解析为「学生·作业名·班级·学校」。

    缺失项直接跳过（如教师无班级、课程无学校）；全部缺失时回退「未知提交」。
    班级优先取该作业课程下的班级，取不到再回退学生任意班级；
    学校优先取课程所属学校，回退学生本人学校。
    """
    if assignment is None and submission.assignment_id:
        assignment = await _first(
            db, select(Assignment).where(Assignment.id == submission.assignment_id)
        )

    student = None
    if submission.student_id:
        student = await _first(db, select(User).where(User.id == submission.student_id))

    cls = None
    if submission.student_id:
        base = (
            select(Class)
            .join(class_students, Class.id == class_students.c.class_id)
            .where(class_students.c.student_id == submission.student_id)
        )
        if assignment is not None:
            cls = await _first(
                db, base.where(Class.course_id == assignment.course_id)
                .order_by(Class.id).limit(1)
            )
        if cls is None:
            cls = await _first(db, base.order_by(Class.id).limit(1))

    school = None
    if assignment is not None and assignment.course_id:
        course = await _first(db, select(Course).where(Course.id == assignment.course_id))
        if course is not None and course.school_id:
            school = await _first(db, select(School).where(School.id == course.school_id))
    if school is None and student is not None and student.school_id:
        school = await _first(db, select(School).where(School.id == student.school_id))

    parts = [
        (student.full_name or student.username) if student else None,
        assignment.title if assignment else None,
        cls.name if cls else None,
        school.name if school else None,
    ]
    return "·".join(p for p in parts if p) or "未知提交"
