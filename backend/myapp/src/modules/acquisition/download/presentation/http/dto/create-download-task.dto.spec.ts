import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateDownloadTaskDto } from "./create-download-task.dto";

describe("CreateDownloadTaskDto", () => {
  it("rejects annas_archive before the request reaches Application", async () => {
    const dto = plainToInstance(CreateDownloadTaskDto, {
      bookId: 41,
      sourcePlatform: "annas_archive",
      sourceUrl: "https://fixture.invalid/file",
    });

    const errors = await validate(dto);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "sourcePlatform" }),
    ]));
  });

  it("accepts zlibrary", async () => {
    const dto = plainToInstance(CreateDownloadTaskDto, {
      bookId: 41,
      sourcePlatform: "zlibrary",
      sourceUrl: "https://fixture.invalid/file",
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
