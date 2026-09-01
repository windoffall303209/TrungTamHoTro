import { Global, Module } from "@nestjs/common";
import { EmailDeliveryService } from "./email-delivery.service.js";
import { ObjectStorageService } from "./object-storage.service.js";
import { AntivirusService } from "./antivirus.service.js";
import { DatabaseBackupService } from "./database-backup.service.js";

@Global()
@Module({
  providers: [AntivirusService, DatabaseBackupService, EmailDeliveryService, ObjectStorageService],
  exports: [AntivirusService, DatabaseBackupService, EmailDeliveryService, ObjectStorageService],
})
export class InfrastructureModule {}
