import { Global, Module } from "@nestjs/common";
import { EmailDeliveryService } from "./email-delivery.service.js";
import { ObjectStorageService } from "./object-storage.service.js";
import { AntivirusService } from "./antivirus.service.js";
import { DatabaseBackupService } from "./database-backup.service.js";
import { OutboxDeliveryService } from "./outbox-delivery.service.js";

@Global()
@Module({
  providers: [AntivirusService, DatabaseBackupService, EmailDeliveryService, ObjectStorageService, OutboxDeliveryService],
  exports: [AntivirusService, DatabaseBackupService, EmailDeliveryService, ObjectStorageService, OutboxDeliveryService],
})
/** Export các adapter I/O ngoài tiến trình dưới dạng singleton toàn cục. */
export class InfrastructureModule {}
