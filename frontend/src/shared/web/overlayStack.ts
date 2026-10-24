// 浮层栈：所有 Teleport 到 body 的浮层（弹窗、底部弹出页、抽屉）都在这里登记。
// 有浮层打开时：#app 设为 inert（背景不可点、不可聚焦、读屏跳过）、锁定页面滚动；
// Esc 只关闭最上面的一层。同级浮层按打开顺序叠放（后打开的 DOM 在后，层级相同时在上）。

export interface OverlayEntry {
    onEscape?: () => void;
}

const stack: OverlayEntry[] = [];

function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || stack.length === 0) return;
    const top = stack[stack.length - 1];
    if (!top.onEscape) return;
    event.preventDefault();
    event.stopPropagation();
    top.onEscape();
}

function setBackgroundBlocked(blocked: boolean) {
    const app = document.getElementById('app');
    if (blocked) {
        app?.setAttribute('inert', '');
        document.documentElement.classList.add('ui-scroll-locked');
        document.addEventListener('keydown', onKeydown, true);
    } else {
        app?.removeAttribute('inert');
        document.documentElement.classList.remove('ui-scroll-locked');
        document.removeEventListener('keydown', onKeydown, true);
    }
}

/** 登记一个打开的浮层，返回释放函数；释放可重复调用 */
export function pushOverlay(entry: OverlayEntry): () => void {
    stack.push(entry);
    if (stack.length === 1) setBackgroundBlocked(true);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const index = stack.indexOf(entry);
        if (index >= 0) stack.splice(index, 1);
        if (stack.length === 0) setBackgroundBlocked(false);
    };
}

export function isTopOverlay(entry: OverlayEntry): boolean {
    return stack[stack.length - 1] === entry;
}

export function openOverlayCount(): number {
    return stack.length;
}
