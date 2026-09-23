import { Module } from "@nestjs/common";
import { AcquisitionModule } from "../modules/acquisition/public";

/**
 * 外部元数据数据源的装配模块。
 *
 * ⚠️ 脱敏说明（公开版本）
 * 原本这里注册了两组外部数据源 Provider：
 *   - `./zlibrary/*`：电子书检索 / 下载 / 元数据补全，及其上游认证与响应投影
 *   - `./douban/*`  ：图书评分与出版信息刮削
 * 它们只实现 `modules/intelligent-library/public` 暴露的 Port 接口，属于依赖倒置里
 * 「最外层的可替换实现」。为避免公开具体上游地址、接口参数与认证流程，这两个目录
 * 已在本仓库中整体移除。
 *
 * TODO(自行实现)：想跑通完整功能，需要在此提供以下 Port 的实现并注册进 providers/exports：
 *   - `METADATA_SOURCE_PORTS`        —— 元数据来源列表（MetadataSourcePort[]）
 *   - `METADATA_SOURCE_CONTEXT_PORT` —— 元数据来源的请求上下文（凭据 / base URL）
 *   - `DOUBAN_RATING_SOURCE_PORT`    —— 评分来源
 *   - `SourceRegistry` 所需的 Search / Download Provider（见 modules/acquisition/acquisition.module.ts）
 * 领域层、应用层与 Port 定义均未改动，替换实现即可恢复运行。
 */
@Module({
  imports: [AcquisitionModule],
  providers: [],
  exports: [],
})
export class MetadataIntegrationsModule {}
