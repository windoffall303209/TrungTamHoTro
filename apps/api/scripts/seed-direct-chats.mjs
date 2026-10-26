import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { buildDatabaseUrl } from "../src/config/database-connection.js";
import { randomUUID } from "node:crypto";

config({ path: "../../.env" });
config();

const connectionString = buildDatabaseUrl(process.env);
const adapter = new PrismaPg({ connectionString, max: 2 });
const prisma = new PrismaClient({ adapter });

/** Tạo hội thoại 1-1 và chèn các tin nhắn mẫu vào CSDL PostgreSQL */
async function seedDirectChats() {
  console.log("Đang kết nối cơ sở dữ liệu PostgreSQL...");
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    include: { roles: { include: { role: true } } },
  });

  console.log(`Tìm thấy ${users.length} tài khoản người dùng trong CSDL.`);

  const admin = users.find((u) => u.roles.some((r) => r.role.code === "SYSTEM_ADMIN"));
  const instructor = users.find((u) => u.roles.some((r) => r.role.code === "INSTRUCTOR"));
  const learners = users.filter((u) => u.roles.some((r) => r.role.code === "LEARNER"));
  const manager = users.find((u) => u.roles.some((r) => r.role.code === "CENTER_MANAGER"));

  if (!learners.length) {
    console.error("Không tìm thấy học viên nào trong CSDL.");
    return;
  }

  const primaryLearner = learners[0]; // Thường là usr-learner hoặc demo-learner-001
  console.log(`Tài khoản học viên chính: ${primaryLearner.displayName} (${primaryLearner.id})`);

  // Danh sách các cặp liên hệ 1-1 cần thiết lập với học viên chính
  const targetPartners = [
    instructor,
    users.find((u) => u.id === "demo-instructor-01") || users.find((u) => u.roles.some((r) => r.role.code === "INSTRUCTOR" && u.id !== instructor?.id)),
    manager,
    admin,
    learners[1] || learners[0],
    learners[2] || learners[0],
  ].filter(Boolean);

  // Mẫu các đoạn hội thoại thực tế
  const sampleDialogues = [
    [
      { sender: "partner", text: "Chào em, em cần hỗ trợ bài học hay có thắc mắc gì về bài kiểm tra vừa rồi không?" },
      { sender: "me", text: "Dạ em chào Thầy/Cô, em đang xem lại phần bài tập hôm trước nhưng chưa hiểu rõ câu hỏi số 3 ạ." },
      { sender: "partner", text: "Thầy/Cô đã xem bài nộp của em. Em xem lại công thức ở mục 3 tài liệu chương 2 nhé, kết quả em làm gần đúng rồi đấy!" },
      { sender: "me", text: "Dạ vâng em cảm ơn Thầy/Cô nhiều, em sẽ nộp lại bản sửa sớm ạ." },
    ],
    [
      { sender: "partner", text: "Chào bạn! Chiều nay bạn có tham gia buổi thực hành trực tuyến không?" },
      { sender: "me", text: "Có nha bạn ơi, 15h vào phòng học nhé." },
      { sender: "partner", text: "Ok bạn, làm bài tập lớn xong nhớ gửi mình đối chiếu kết quả nhé!" },
    ],
    [
      { sender: "partner", text: "Thông báo từ Ban quản lý: Lịch học tuần tới đã được cập nhật trên thời khóa biểu." },
      { sender: "me", text: "Dạ em đã nhận được thông tin, em cảm ơn ạ." },
    ],
    [
      { sender: "partner", text: "Hệ thống hỗ trợ kỹ thuật Wind EDU: Chào bạn, bạn có gặp sự cố gì khi nộp bài không?" },
      { sender: "me", text: "Dạ hệ thống chạy rất mượt, em cảm ơn admin ạ!" },
    ],
    [
      { sender: "partner", text: "Bạn ơi cho mình hỏi tài liệu ôn thi tải ở mục nào vậy?" },
      { sender: "me", text: "Bạn vào tab Kho tài liệu ở thanh điều hướng bên trên là thấy nhé!" },
      { sender: "partner", text: "Cảm ơn bạn nhiều nha!" },
    ],
  ];

  let convCount = 0;
  let msgCount = 0;

  for (let i = 0; i < targetPartners.length; i++) {
    const partner = targetPartners[i];
    if (!partner || partner.id === primaryLearner.id) continue;

    const directKey = [primaryLearner.id, partner.id].sort().join(":");
    const convId = `conv-direct-${randomUUID()}`;

    const conversation = await prisma.chatConversation.upsert({
      where: { directKey },
      update: {},
      create: {
        id: convId,
        type: "DIRECT",
        directKey,
        createdById: primaryLearner.id,
      },
    });

    convCount++;

    // Upsert thành viên 1
    const pLearnerRole = primaryLearner.roles[0]?.role?.code || "LEARNER";
    await prisma.chatConversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: primaryLearner.id,
        },
      },
      update: { status: "ACTIVE" },
      create: {
        conversationId: conversation.id,
        userId: primaryLearner.id,
        roleSnapshot: pLearnerRole,
        status: "ACTIVE",
      },
    });

    // Upsert thành viên 2
    const partnerRole = partner.roles[0]?.role?.code || "MEMBER";
    await prisma.chatConversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: partner.id,
        },
      },
      update: { status: "ACTIVE" },
      create: {
        conversationId: conversation.id,
        userId: partner.id,
        roleSnapshot: partnerRole,
        status: "ACTIVE",
      },
    });

    // Chèn tin nhắn nếu hội thoại chưa có tin
    const existingMessages = await prisma.chatMessage.count({
      where: { conversationId: conversation.id },
    });

    if (existingMessages === 0) {
      const dialogue = sampleDialogues[i % sampleDialogues.length];
      const baseTime = Date.now() - (targetPartners.length - i) * 3600_000;

      for (let mIdx = 0; mIdx < dialogue.length; mIdx++) {
        const item = dialogue[mIdx];
        const senderId = item.sender === "me" ? primaryLearner.id : partner.id;
        const createdAt = new Date(baseTime + mIdx * 180_000);

        await prisma.chatMessage.create({
          data: {
            id: `msg-${randomUUID()}`,
            conversationId: conversation.id,
            senderId,
            clientMessageId: `cli-${randomUUID()}`,
            content: item.text,
            createdAt,
          },
        });
        msgCount++;
      }
    }
  }

  // Thiết lập thêm các cặp 1-1 giữa các giảng viên, quản trị viên và học viên
  const mainUsers = [primaryLearner, instructor, admin, manager].filter(Boolean);
  for (let u1 = 0; u1 < mainUsers.length; u1++) {
    for (let u2 = u1 + 1; u2 < mainUsers.length; u2++) {
      const user1 = mainUsers[u1];
      const user2 = mainUsers[u2];
      const directKey = [user1.id, user2.id].sort().join(":");
      const conv = await prisma.chatConversation.upsert({
        where: { directKey },
        update: {},
        create: {
          id: `conv-direct-${randomUUID()}`,
          type: "DIRECT",
          directKey,
          createdById: user1.id,
        },
      });

      for (const u of [user1, user2]) {
        await prisma.chatConversationMember.upsert({
          where: {
            conversationId_userId: {
              conversationId: conv.id,
              userId: u.id,
            },
          },
          update: { status: "ACTIVE" },
          create: {
            conversationId: conv.id,
            userId: u.id,
            roleSnapshot: u.roles[0]?.role?.code || "MEMBER",
            status: "ACTIVE",
          },
        });
      }

      const existing = await prisma.chatMessage.count({ where: { conversationId: conv.id } });
      if (existing === 0) {
        await prisma.chatMessage.create({
          data: {
            id: `msg-${randomUUID()}`,
            conversationId: conv.id,
            senderId: user2.id,
            clientMessageId: `cli-${randomUUID()}`,
            content: `Chào ${user1.displayName}, mình trao đổi về tiến độ học tập và quản lý lớp học nhé!`,
            createdAt: new Date(Date.now() - 7200_000),
          },
        });
        await prisma.chatMessage.create({
          data: {
            id: `msg-${randomUUID()}`,
            conversationId: conv.id,
            senderId: user1.id,
            clientMessageId: `cli-${randomUUID()}`,
            content: "Chào bạn, mình đã cập nhật thông tin mới nhất trên hệ thống rồi nhé.",
            createdAt: new Date(Date.now() - 3600_000),
          },
        });
      }
    }
  }
}

seedDirectChats()
  .catch((err) => {
    console.error("Lỗi khi seed chat:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
