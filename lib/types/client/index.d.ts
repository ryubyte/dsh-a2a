/**
 * dsh-a2a — browser half.
 *
 * Contributes the "A2A 连接" settings section: a dashboard showing who is
 * connected TO this DSH (inbound peers) and who this DSH is connected TO
 * (outbound agents), with reconnect / close controls per connection.
 *
 * The data and the controls live behind the host's `/a2a/api` routes
 * (served by the node half on the same webserver); the browser half is a
 * thin read/write client with no protocol knowledge.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
/** Services this plugin needs from the client runtime. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
type SectionProps = PropsRuntime<'settings.section'>;
/** The A2A connection dashboard settings section. */
export declare function DashboardSection(_props: SectionProps): ReactElement;
export {};
//# sourceMappingURL=index.d.ts.map