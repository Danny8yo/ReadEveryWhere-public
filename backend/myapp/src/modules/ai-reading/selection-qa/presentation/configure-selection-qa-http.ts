import {
  PayloadTooLargeException,
  type INestApplication,
} from "@nestjs/common";
import { json, type Request, type Response, type NextFunction } from "express";

/** Install before app.init/listen; module middleware runs after Nest's parser. */
export function configureSelectionQaHttp(app: INestApplication): void {
  const parse = json({ limit: 256 * 1024 });
  // A distinct name preserves Nest ExpressAdapter's default jsonParser registration.
  app.use(
    "/api/v1/selection-qa",
    function selectionQaJsonBody(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      parse(req, res, (error?: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "type" in error &&
          error.type === "entity.too.large"
        ) {
          next(
            new PayloadTooLargeException(
              "Selection QA JSON body exceeds 256 KiB",
            ),
          );
          return;
        }
        next(error);
      });
    },
  );
}
