import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { AssignUserDto, CreateClassDto, CreateCourseDto } from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { LearningClass, LearningCourse } from "./learning.types.js";

@ApiTags("Course & Class")
@Controller()
export class CourseController {
  constructor(private readonly learning: LearningService) {}

  @Get("manager/courses") @RequirePermissions("course:view")
  listCourses(): Promise<LearningCourse[]> { return this.learning.listCourses(); }

  @Post("manager/courses") @RequirePermissions("course:manage")
  createCourse(@Body() input: CreateCourseDto): Promise<LearningCourse> { return this.learning.createCourse(input); }

  @Post("manager/courses/:courseId/publish") @RequirePermissions("course:manage")
  publishCourse(@Param("courseId") courseId: string): Promise<LearningCourse> { return this.learning.publishCourse(courseId); }

  @Get("classes") @RequirePermissions("class:view")
  listClasses(@Headers("x-role-code") role = "LEARNER"): Promise<LearningClass[]> { return this.learning.listClasses(role); }

  @Get("instructor/classes") @RequirePermissions("class:view")
  listInstructorClasses(): Promise<LearningClass[]> { return this.learning.listClasses("INSTRUCTOR"); }

  @Get("learner/classes") @RequirePermissions("class:view")
  listLearnerClasses(): Promise<LearningClass[]> { return this.learning.listClasses("LEARNER"); }

  @Post("manager/classes") @RequirePermissions("class:manage")
  createClass(@Body() input: CreateClassDto): Promise<LearningClass> { return this.learning.createClass(input); }

  @Post("manager/classes/:classId/instructors") @RequirePermissions("class:manage")
  assignInstructor(@Param("classId") classId: string, @Body() input: AssignUserDto): Promise<LearningClass> { return this.learning.assignInstructor(classId, input.userId); }

  @Post("manager/classes/:classId/enrollments") @RequirePermissions("class:manage")
  enrollLearner(@Param("classId") classId: string, @Body() input: AssignUserDto): Promise<LearningClass> { return this.learning.enrollLearner(classId, input.userId); }

  @Post("manager/classes/:classId/activate") @RequirePermissions("class:manage")
  activateClass(@Param("classId") classId: string): Promise<LearningClass> { return this.learning.activateClass(classId); }

  @Post("manager/classes/:classId/close") @RequirePermissions("class:manage")
  closeClass(@Param("classId") classId: string): Promise<LearningClass> { return this.learning.closeClass(classId); }
}
