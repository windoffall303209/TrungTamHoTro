import { Global, Module } from "@nestjs/common";
import { EmailDeliveryService } from "./email-delivery.service.js";
import { ObjectStorageService } from "./object-storage.service.js";
import { AntivirusService } from "./antivirus.service.js";

@Global()
@Module({
  providers: [AntivirusService, EmailDeliveryService, ObjectStorageService],
  exports: [AntivirusService, EmailDeliveryService, ObjectStorageService],
})
export class InfrastructureModule {}
