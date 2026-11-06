/**
 * Home — the todos demo with the home chat room beside it. The chat is
 * attached, not built in: the page only places `HomeChat`, whose room is
 * @shared/domain/home-chat.
 */
import { TESTID } from '../testing/testids';
import { HomeChat } from './home-chat';
import { TodosPage } from './todos-page';

export function HomePage() {
  return (
    <div className="home-layout" data-testid={TESTID.home.page}>
      <TodosPage />
      <HomeChat />
    </div>
  );
}
