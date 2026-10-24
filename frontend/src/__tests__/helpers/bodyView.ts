// 测试 Teleport 到 body 的浮层组件（UiOverlay、ContextMenu 等）：
// 挂到真实 document.body，DOM 查询从 body 做（和用户看到的页面一致），事件仍从组件读取。
// 搭配 enableAutoUnmount(afterEach) 使用；断言写法与原来的 wrapper 一致。
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';

type MountTarget = Parameters<typeof mount>[0];
type MountOptions = Parameters<typeof mount>[1];

export function bodyView(emitter: VueWrapper): VueWrapper {
  const body = new DOMWrapper(document.body);
  return Object.assign(body, {
    emitted: emitter.emitted.bind(emitter),
    vm: emitter.vm,
    setProps: emitter.setProps.bind(emitter),
    unmount: emitter.unmount.bind(emitter),
  }) as unknown as VueWrapper;
}

export function mountInBody(component: MountTarget, options?: MountOptions): VueWrapper {
  const wrapper = mount(component, { ...(options as object), attachTo: document.body } as MountOptions);
  return bodyView(wrapper as VueWrapper);
}
