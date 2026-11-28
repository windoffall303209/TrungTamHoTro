import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { Environment } from "../../../config/environment.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import { SystemService } from "../../system/core/system.service.js";
import type { LearningServiceContext } from "./learning.context.js";
import {
  createDefaultLearningMemoryState,
  createEmptyLearningMemoryState,
  type LearningMemoryState,
} from "./learning-memory-store.js";
import * as access_ops from "../operations/access/learning-access.js";
import * as analytics_ops from "../operations/analytics/learning-analytics.js";
import * as attempts_ops from "../operations/exams/learning-attempts.js";
import * as class_enrollments_ops from "../operations/classes/learning-class-enrollments.js";
import * as class_lifecycle_ops from "../operations/classes/learning-class-lifecycle.js";
import * as class_rules_ops from "../operations/classes/learning-class-rules.js";
import * as content_rules_ops from "../operations/content/learning-content-rules.js";
import * as engagement_mapping_ops from "../operations/engagement/learning-engagement-mapping.js";
import * as file_rules_ops from "../operations/materials/learning-file-rules.js";
import * as forum_rules_ops from "../operations/forum/learning-forum-rules.js";
import * as grading_ops from "../operations/grading/learning-grading.js";
import * as lookups_ops from "../operations/support/learning-lookups.js";
import * as mapping_ops from "../operations/mapping/learning-mapping.js";
import * as material_downloads_ops from "../operations/materials/learning-material-downloads.js";
import * as materials_ops from "../operations/materials/learning-materials.js";
import * as moderation_ops from "../operations/moderation/learning-moderation.js";
import * as providers_ops from "../operations/support/learning-providers.js";
import * as question_rules_ops from "../operations/questions/learning-question-rules.js";
import * as questions_ops from "../operations/questions/learning-questions.js";
import * as recordings_ops from "../operations/live/learning-recordings.js";
import * as report_rules_ops from "../operations/reports/learning-report-rules.js";
import * as result_mapping_ops from "../operations/mapping/learning-result-mapping.js";
import * as session_mapping_ops from "../operations/mapping/learning-session-mapping.js";
import * as storage_ops from "../operations/storage/learning-storage.js";

@Injectable()
/** Cung cấp ngữ cảnh hạ tầng dùng chung (Prisma, storage, antivirus, system) và ranh giới bộ nhớ kiểm thử cho các domain service đào tạo. */
export class LearningRuntimeService {
  private readonly receiptFallbackSecret = randomBytes(32).toString("hex");
  readonly memoryState: LearningMemoryState;
  readonly context: LearningServiceContext;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
    @Optional() private readonly objectStorage?: ObjectStorageService,
    @Optional() private readonly antivirus?: AntivirusService,
    @Optional() private readonly system?: SystemService,
    @Optional() customMemoryState?: LearningMemoryState,
  ) {
    // Chỉ nạp fixture mẫu khi chạy kiểm thử không có kết nối DB thật; môi trường DB thật cấp phát trạng thái rỗng.
    const dbActive = Boolean(prisma?.isStartupConnectionEnabled?.());
    this.memoryState =
      customMemoryState ??
      (dbActive ? createEmptyLearningMemoryState() : createDefaultLearningMemoryState());
    this.context = this.buildContext();
  }

  /** Dựng đối tượng LearningServiceContext nối trực tiếp tới các operation và hạ tầng dùng chung. */
  private buildContext(): LearningServiceContext {
    const state = this.memoryState;
    const { prisma, config, objectStorage, antivirus, system, receiptFallbackSecret } = this;
    const ctx: LearningServiceContext = {
      get courses() {
        return state.courses;
      },
      get courseVersions() {
        return state.courseVersions;
      },
      get classes() {
        return state.classes;
      },
      folderRegistry: state.folderRegistry,
      get materials() {
        return state.materials;
      },
      get questions() {
        return state.questions;
      },
      get questionImages() {
        return state.questionImages;
      },
      get exams() {
        return state.exams;
      },
      get attempts() {
        return state.attempts;
      },
      get regradeRequests() {
        return state.regradeRequests;
      },
      get topics() {
        return state.topics;
      },
      get posts() {
        return state.posts;
      },
      get notifications() {
        return state.notifications;
      },
      get sessions() {
        return state.sessions;
      },
      get tickets() {
        return state.tickets;
      },
      get ticketComments() {
        return state.ticketComments;
      },
      get supportAttachmentFiles() {
        return state.supportAttachmentFiles;
      },
      get materialFiles() {
        return state.materialFiles;
      },
      get progressInterventions() {
        return state.progressInterventions;
      },
      get instructorRoles() {
        return state.instructorRoles;
      },
      get prisma() {
        return prisma;
      },
      get config() {
        return config;
      },
      get objectStorage() {
        return objectStorage;
      },
      get antivirus() {
        return antivirus;
      },
      get system() {
        return system;
      },
      enrollLearner: (classId, learnerId, actorId) =>
        class_enrollments_ops.enrollLearner(ctx, classId, learnerId, actorId),
      getClassClosureReadiness: (classId) =>
        class_lifecycle_ops.getClassClosureReadiness(ctx, classId),
      databaseClassClosureReadiness: (database, classId) =>
        class_lifecycle_ops.databaseClassClosureReadiness(ctx, database, classId),
      getMaterialSummary: (actorId, role, classId) =>
        materials_ops.getMaterialSummary(ctx, actorId, role, classId),
      searchAccessibleMaterials: (input, learnerId, role) =>
        materials_ops.searchAccessibleMaterials(ctx, input, learnerId, role),
      resolveMaterialDownload: (materialId, expires, signature, role, action, actorId) =>
        material_downloads_ops.resolveMaterialDownload(
          ctx,
          materialId,
          expires,
          signature,
          role,
          action,
          actorId,
        ),
      createQuestion: (input, authorId) => questions_ops.createQuestion(ctx, input, authorId),
      submitAttempt: (attemptId, learnerId, trigger) =>
        attempts_ops.submitAttempt(ctx, attemptId, learnerId, trigger),
      listLearnerResults: (learnerId) => attempts_ops.listLearnerResults(ctx, learnerId),
      gradeAttempt: (attemptId, score, feedback, correctionReason, graderId, questionScores) =>
        grading_ops.gradeAttempt(
          ctx,
          attemptId,
          score,
          feedback,
          correctionReason,
          graderId,
          questionScores,
        ),
      listNotifications: (recipientId) => moderation_ops.listNotifications(ctx, recipientId),
      markNotificationRead: (notificationId, recipientId) =>
        moderation_ops.markNotificationRead(ctx, notificationId, recipientId),
      isRecordingAvailable: (session) => recordings_ops.isRecordingAvailable(session),
      database: () => mapping_ops.database(ctx),
      mapCourse: (row) => mapping_ops.mapCourse(ctx, row),
      mapClass: (row) => mapping_ops.mapClass(row),
      mapMaterial: (row) => mapping_ops.mapMaterial(ctx, row),
      mapQuestion: (row) => mapping_ops.mapQuestion(ctx, row),
      getExamAnalytics: (input, actorId) => analytics_ops.getExamAnalytics(ctx, input, actorId),
      cloneQuestion: (item) => question_rules_ops.cloneQuestion(item),
      latestQuestionVersions: (items) => question_rules_ops.latestQuestionVersions(items),
      sameGeneratedQuestion: (existing, generated) =>
        question_rules_ops.sameGeneratedQuestion(existing, generated),
      questionContentHash: (content) => question_rules_ops.questionContentHash(content),
      validateQuestionInput: (input) => question_rules_ops.validateQuestionInput(input),
      validateSubmittedAnswers: (question, answers) =>
        question_rules_ops.validateSubmittedAnswers(question, answers),
      isQuestionAnswerCorrect: (question, submitted) =>
        question_rules_ops.isQuestionAnswerCorrect(question, submitted),
      mapExam: (row) => result_mapping_ops.mapExam(row),
      mapAttempt: (row) => result_mapping_ops.mapAttempt(ctx, row),
      submissionReceipt: (attempt, submittedAt) =>
        result_mapping_ops.submissionReceipt(
          attempt,
          submittedAt,
          config?.get("AUTH_ENCRYPTION_SECRET", { infer: true }) ||
            receiptFallbackSecret,
        ),
      mapRegradeRequest: (row) => result_mapping_ops.mapRegradeRequest(row),
      mapTopic: (row) => engagement_mapping_ops.mapTopic(ctx, row),
      mapPost: (row) => engagement_mapping_ops.mapPost(row),
      mapProgressIntervention: (row) => engagement_mapping_ops.mapProgressIntervention(ctx, row),
      progressInterventionHistory: (value) =>
        engagement_mapping_ops.progressInterventionHistory(value),
      reportingPeriod: (fromInput, toInput) => report_rules_ops.reportingPeriod(fromInput, toInput),
      validateRiskThresholds: (thresholds) => report_rules_ops.validateRiskThresholds(thresholds),
      validateTimezone: (timezone) => report_rules_ops.validateTimezone(timezone),
      percentage: (numerator, denominator) => report_rules_ops.percentage(numerator, denominator),
      latestDate: (values) => report_rules_ops.latestDate(values),
      buildLearnerProgress: (input) => report_rules_ops.buildLearnerProgress(input),
      buildProviderUrls: (provider, token) => providers_ops.buildProviderUrls(provider, token),
      seededOrder: (values, seed) => providers_ops.seededOrder(values, seed),
      resolveExamScoreAllocations: (questionIds, totalScore, allocations) =>
        providers_ops.resolveExamScoreAllocations(questionIds, totalScore, allocations),
      examQuestionScore: (exam, questionId) => providers_ops.examQuestionScore(exam, questionId),
      provisionProviderMeeting: (requested) => providers_ops.provisionProviderMeeting(ctx, requested),
      userIdsForRole: (database, roleCode) => providers_ops.userIdsForRole(database, roleCode),
      notifyClassMembers: (
        database,
        classId,
        type,
        title,
        entityId,
        templateEventCode,
        templateVariables,
      ) =>
        providers_ops.notifyClassMembers(
          ctx,
          database,
          classId,
          type,
          title,
          entityId,
          templateEventCode,
          templateVariables,
        ),
      mapSession: (row) => session_mapping_ops.mapSession(ctx, row),
      mapTicket: (row) => session_mapping_ops.mapTicket(row),
      isLiveProvider: (value) => providers_ops.isLiveProvider(value),
      buildClassClosureReadiness: (status, endAt, counts) =>
        class_rules_ops.buildClassClosureReadiness(status, endAt, counts),
      getDatabaseClass: (database, classId) => class_rules_ops.getDatabaseClass(ctx, database, classId),
      getDatabaseExam: (database, examId) => class_rules_ops.getDatabaseExam(ctx, database, examId),
      getDatabaseAttempt: (database, attemptId) =>
        class_rules_ops.getDatabaseAttempt(ctx, database, attemptId),
      requireUserRole: (database, userId, roleCode, message) =>
        class_rules_ops.requireUserRole(database, userId, roleCode, message),
      getStoragePolicy: (database) => storage_ops.getStoragePolicy(database),
      storeUpload: (classId, materialId, upload, quarantined) =>
        storage_ops.storeUpload(ctx, classId, materialId, upload, quarantined),
      writeStoredFile: (objectKey, buffer) => storage_ops.writeStoredFile(ctx, objectKey, buffer),
      removeStoredFile: (objectKey) => storage_ops.removeStoredFile(ctx, objectKey),
      removeQuestionObjectIfUnreferenced: (objectKey) =>
        storage_ops.removeQuestionObjectIfUnreferenced(ctx, objectKey),
      resolveObjectPath: (objectKey) => storage_ops.resolveObjectPath(ctx, objectKey),
      signMaterialAccess: (materialId, expires, action) =>
        storage_ops.signMaterialAccess(ctx, materialId, expires, action),
      signRecordingAccess: (sessionId, expires, learnerId) =>
        storage_ops.signRecordingAccess(ctx, sessionId, expires, learnerId),
      verifyExpiringSignature: (expectedSignature, expires, signature, message) =>
        storage_ops.verifyExpiringSignature(expectedSignature, expires, signature, message),
      verifyMaterialAccess: (materialId, expires, signature, action) =>
        storage_ops.verifyMaterialAccess(ctx, materialId, expires, signature, action),
      userIdForRole: (role) => access_ops.userIdForRole(role),
      readStoredFile: (objectKey) => access_ops.readStoredFile(ctx, objectKey),
      isMaterialObjectKey: (objectKey) => access_ops.isMaterialObjectKey(objectKey),
      canManageSupport: (role) => access_ops.canManageSupport(role),
      canAccessMemoryMaterial: (material, role, actorId) =>
        access_ops.canAccessMemoryMaterial(ctx, material, role, actorId),
      examAvailability: (exam, attemptCount, active, timestamp) =>
        access_ops.examAvailability(exam, attemptCount, active, timestamp),
      attemptDeadline: (startedAt, durationMinutes, examCloseAt) =>
        access_ops.attemptDeadline(startedAt, durationMinutes, examCloseAt),
      isMemoryAnswerCorrect: (questionId, submitted) =>
        access_ops.isMemoryAnswerCorrect(ctx, questionId, submitted),
      validateForumContent: (value, label) => content_rules_ops.validateForumContent(value, label),
      validateSupportText: (value, label) => content_rules_ops.validateSupportText(ctx, value, label),
      validateSupportUpload: (upload) => content_rules_ops.validateSupportUpload(ctx, upload),
      detectMaliciousUpload: (upload) => file_rules_ops.detectMaliciousUpload(upload),
      validateQuestionImage: (upload) => file_rules_ops.validateQuestionImage(ctx, upload),
      scanUpload: (upload) => file_rules_ops.scanUpload(ctx, upload),
      assertForumClassAccess: (classItem, role, actorId) =>
        forum_rules_ops.assertForumClassAccess(classItem, role, actorId),
      assertMemoryForumClassAccess: (classId, role, actorId) =>
        forum_rules_ops.assertMemoryForumClassAccess(ctx, classId, role, actorId),
      toStringArray: (value) => lookups_ops.toStringArray(value),
      findCourse: (courseId) => lookups_ops.findCourse(ctx, courseId),
      findClass: (classId) => lookups_ops.findClass(ctx, classId),
      findExam: (examId) => lookups_ops.findExam(ctx, examId),
      findAttempt: (attemptId) => lookups_ops.findAttempt(ctx, attemptId),
      findTopic: (topicId) => lookups_ops.findTopic(ctx, topicId),
      findPost: (postId) => lookups_ops.findPost(ctx, postId),
      findSession: (sessionId) => lookups_ops.findSession(ctx, sessionId),
    };
    return ctx;
  }
}

/** Tạo runtime kiểm thử cô lập theo ranh giới in-memory rõ ràng, tránh dùng chung trạng thái giữa các ca test. */
export function createLearningTestRuntime(
  overrides: {
    prisma?: PrismaService;
    config?: ConfigService<Environment, true>;
    objectStorage?: ObjectStorageService;
    antivirus?: AntivirusService;
    system?: SystemService;
    memoryState?: LearningMemoryState;
  } = {},
): LearningRuntimeService {
  return new LearningRuntimeService(
    overrides.prisma,
    overrides.config,
    overrides.objectStorage,
    overrides.antivirus,
    overrides.system,
    overrides.memoryState,
  );
}
