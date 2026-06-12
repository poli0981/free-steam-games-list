import { useParams } from "react-router-dom";
import { ERROR_CODES, ErrorPage, type ErrorCode } from "./ErrorPage";

/**
 * #/error/:code — deep-linkable error pages (403/404/419/5xx/offline).
 * Unknown codes render the 404 page in place (no redirect — preserves the
 * URL for debugging and avoids redirect-loop bugs).
 */
export function ErrorCodeRoute() {
  const { code } = useParams();
  const valid = (ERROR_CODES as readonly string[]).includes(code ?? "");
  return <ErrorPage code={valid ? (code as ErrorCode) : "404"} />;
}
