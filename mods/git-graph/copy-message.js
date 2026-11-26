// Read the selected commit's full message on its own machine, without a shell.
import { READ } from "./git.js";

export async function readCommitMessage(hash, ctx, exec) {
  if (typeof hash !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
    return { ok: false, message: "Invalid commit identity." };
  }
  try {
    const result = await exec("git", [...READ, "show", "-s", "--format=%B", "--no-show-signature", hash, "--"], { cwd: ctx.root, on: ctx.on });
    if (result.code !== 0) return { ok: false, message: result.stderr?.trim() || "Couldn't read the commit message." };
    // Git's pretty printer appends one newline beyond the message terminator.
    return { ok: true, text: result.stdout.replace(/\n$/, "") };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  }
}
