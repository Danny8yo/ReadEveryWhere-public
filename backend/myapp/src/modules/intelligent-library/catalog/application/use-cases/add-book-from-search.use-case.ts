import type { LibraryBookView } from "../query-model/library-book.view";
import type { CreateBookCommand } from "../catalog.commands";
import { CreateBookUseCase } from "./create-book.use-case";

export class AddBookFromSearchUseCase {
  constructor(private readonly createBookUseCase: CreateBookUseCase) {}

  execute(userId: number, dto: CreateBookCommand): LibraryBookView {
    return this.createBookUseCase.execute(userId, dto);
  }
}
