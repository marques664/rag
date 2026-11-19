export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
  parentSpanId?: string;
}

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export interface SpanAttributeMap {
  [key: string]: string | number | boolean | undefined;
}

export interface RecordedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: SpanStatusCode;
  statusMessage?: string;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanExporter {
  exportSpan(span: RecordedSpan): void;
}

const TRACEPARENT_REGEX =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function randomHexBytes(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateTraceId(): string {
  return randomHexBytes(16);
}

export function generateSpanId(): string {
  return randomHexBytes(8);
}

/**
 * Parses an incoming W3C `traceparent` header (`00-<traceId>-<spanId>-<flags>`).
 * Returns null if missing, malformed, or containing all-zero trace/span IDs.
 */
export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  const match = TRACEPARENT_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const version = match[1]!.toLowerCase();
  const traceId = match[2]!.toLowerCase();
  const spanId = match[3]!.toLowerCase();
  const traceFlags = match[4]!.toLowerCase();

  if (version === 'ff' || /^0+$/.test(traceId) || /^0+$/.test(spanId)) {
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags,
  };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags || '01'}`;
}

export function createRootTraceContext(incomingHeader?: string): TraceContext {
  const parsed = parseTraceparent(incomingHeader);
  if (parsed) {
    return {
      traceId: parsed.traceId,
      parentSpanId: parsed.spanId,
      spanId: generateSpanId(),
      traceFlags: parsed.traceFlags,
    };
  }
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    traceFlags: '01',
  };
}

export function createChildTraceContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    parentSpanId: parent.spanId,
    spanId: generateSpanId(),
    traceFlags: parent.traceFlags,
  };
}

function sanitizeAttributes(
  input: SpanAttributeMap | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input) {
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

export class ActiveSpan {
  private readonly startPerf = performance.now();
  private readonly startEpochMs = Date.now();
  private ended = false;
  private status: SpanStatusCode = 'UNSET';
  private statusMessage?: string;
  private readonly attributes: Record<string, string | number | boolean>;

  constructor(
    public readonly context: TraceContext,
    public readonly name: string,
    private readonly serviceName: string,
    initialAttributes?: SpanAttributeMap,
    private readonly onEnd?: (span: RecordedSpan) => void,
  ) {
    this.attributes = sanitizeAttributes(initialAttributes);
  }

  public setAttributes(attrs: SpanAttributeMap): void {
    Object.assign(this.attributes, sanitizeAttributes(attrs));
  }

  public setStatus(code: SpanStatusCode, message?: string): void {
    this.status = code;
    this.statusMessage = message;
  }

  public recordException(error: unknown): void {
    this.status = 'ERROR';
    this.statusMessage = error instanceof Error ? error.message : String(error);
    this.attributes['exception.type'] =
      error instanceof Error ? error.name : 'Error';
    this.attributes['exception.message'] = this.statusMessage;
  }

  public end(): RecordedSpan | null {
    if (this.ended) {
      return null;
    }
    this.ended = true;
    const durationMs = Math.max(
      0,
      Number((performance.now() - this.startPerf).toFixed(3)),
    );
    const span: RecordedSpan = {
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      ...(this.context.parentSpanId
        ? { parentSpanId: this.context.parentSpanId }
        : {}),
      name: this.name,
      serviceName: this.serviceName,
      startTimeMs: this.startEpochMs,
      endTimeMs: this.startEpochMs + Math.round(durationMs),
      durationMs,
      status: this.status === 'UNSET' ? 'OK' : this.status,
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
      attributes: this.attributes,
    };
    this.onEnd?.(span);
    return span;
  }
}

/**
 * In-memory ring-buffered OpenTelemetry-compatible tracer with optional OTLP/HTTP
 * JSON export (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) or structured sink callback.
 */
export class TelemetryTracer {
  private readonly spans: RecordedSpan[] = [];

  constructor(
    public readonly serviceName: string,
    private readonly options: {
      maxRetainedSpans?: number;
      exporter?: SpanExporter;
      otlpEndpoint?: string;
    } = {},
  ) {}

  public startSpan(
    name: string,
    parentContext?: TraceContext | null,
    attributes?: SpanAttributeMap,
  ): ActiveSpan {
    const context = parentContext
      ? createChildTraceContext(parentContext)
      : createRootTraceContext();
    return new ActiveSpan(
      context,
      name,
      this.serviceName,
      attributes,
      (recorded) => this.recordSpan(recorded),
    );
  }

  public async withSpan<T>(
    name: string,
    parentContext: TraceContext | null | undefined,
    attributes: SpanAttributeMap | undefined,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(name, parentContext, attributes);
    try {
      const result = await fn(span);
      span.setStatus('OK');
      return result;
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  public getRecordedSpans(): readonly RecordedSpan[] {
    return this.spans;
  }

  private recordSpan(span: RecordedSpan): void {
    const maxRetained = this.options.maxRetainedSpans ?? 200;
    if (maxRetained > 0) {
      this.spans.push(span);
      if (this.spans.length > maxRetained) {
        this.spans.shift();
      }
    }

    this.options.exporter?.exportSpan(span);

    if (this.options.otlpEndpoint) {
      this.sendOtlpSpan(this.options.otlpEndpoint, span);
    }
  }

  private sendOtlpSpan(endpoint: string, span: RecordedSpan): void {
    const url = endpoint.endsWith('/v1/traces')
      ? endpoint
      : `${endpoint.replace(/\/+$/, '')}/v1/traces`;
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: span.serviceName } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: '@enterprise-ai/telemetry', version: '1.0.0' },
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                  name: span.name,
                  kind: 1,
                  startTimeUnixNano: String(BigInt(span.startTimeMs) * 1_000_000n),
                  endTimeUnixNano: String(BigInt(span.endTimeMs) * 1_000_000n),
                  attributes: Object.entries(span.attributes).map(([key, val]) => ({
                    key,
                    value:
                      typeof val === 'number'
                        ? { doubleValue: val }
                        : typeof val === 'boolean'
                          ? { boolValue: val }
                          : { stringValue: val },
                  })),
                  status: {
                    code: span.status === 'ERROR' ? 2 : 1,
                    ...(span.statusMessage ? { message: span.statusMessage } : {}),
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Best-effort non-blocking telemetry export
    });
  }
}
