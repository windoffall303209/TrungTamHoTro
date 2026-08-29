import { Global, Module } from "@nestjs/common";
import { EmailDeliveryService } from "./email-delivery.service.js";
import { ObjectStorageService } from "./object-storage.service.js";

@Global()
@Module({
  providers: [EmailDeliveryService, ObjectStorageService],
  exports: [EmailDeliveryService, ObjectStorageService],
})
export class InfrastructureModule {}
