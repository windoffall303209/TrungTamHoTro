import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

const modules = [
  { key: "storage", name: "Kho dữ liệu", readiness: "foundation-ready" },
  { key: "question-bank", name: "Ngân hàng câu hỏi", readiness: "planned" },
  { key: "forum", name: "Diễn đàn trao đổi", readiness: "planned" },
  { key: "live-class", name: "Lớp học online", readiness: "planned" },
] as const;

@ApiTags("System")
@Controller("system")
export class SystemController {
  @Get("modules")
  @ApiOperation({ summary: "Liệt kê các phân hệ sản phẩm" })
  @ApiOkResponse({ description: "Danh sách phân hệ và trạng thái nền tảng" })
  getModules(): typeof modules {
    return modules;
  }
}

