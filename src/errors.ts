/** Error hierarchy for story-state-engine. All engine failures are typed. */

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EntityNotFoundError extends EngineError {
  readonly entityId: string;
  constructor(entityId: string) {
    super(`实体不存在: ${entityId}`);
    this.entityId = entityId;
  }
}

export class EntityExistsError extends EngineError {
  readonly entityId: string;
  constructor(entityId: string) {
    super(`实体 id 已被占用: ${entityId}`);
    this.entityId = entityId;
  }
}

export class KindMismatchError extends EngineError {
  readonly entityId: string;
  readonly expected: string;
  readonly actual: string;
  constructor(entityId: string, expected: string, actual: string) {
    super(`实体 ${entityId} 类型不符：期望 ${expected}，实际 ${actual}`);
    this.entityId = entityId;
    this.expected = expected;
    this.actual = actual;
  }
}

export class ValidationError extends EngineError {}

export class ForeshadowNotFoundError extends EngineError {
  readonly foreshadowId: string;
  constructor(foreshadowId: string) {
    super(`伏笔不存在: ${foreshadowId}`);
    this.foreshadowId = foreshadowId;
  }
}

export class SchemaVersionError extends EngineError {
  readonly found: number;
  readonly expected: number;
  constructor(found: number, expected: number) {
    super(`项目数据版本不兼容：文件为 v${found}，引擎支持 v${expected}`);
    this.found = found;
    this.expected = expected;
  }
}

export class StoreError extends EngineError {}
