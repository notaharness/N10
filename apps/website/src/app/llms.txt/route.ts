import { getLlmsIndex } from '@/lib/llms';

export const dynamic = 'force-static';

export function GET() {
  return new Response(getLlmsIndex(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
