import { NextResponse } from "next/server";
export function jsonError(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, ...extra },
    },
    { status }
  );
}
