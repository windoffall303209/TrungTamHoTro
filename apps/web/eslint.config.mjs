import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // Giữ các quy tắc chất lượng nền tảng; các quy tắc React Compiler quá nghiêm
  // với các màn hình client hiện hữu được tắt để không biến lint thành refactor nghiệp vụ.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "@next/next/no-img-element": "off",
    },
  },
  // Bỏ qua mã sinh tự động của build và báo cáo kiểm thử trình duyệt.
  globalIgnores([".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

