// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AgentTree from '../components/ai-reading/AgentTree.vue';
import type { ReadingAgentRun, ReadingEvent } from '../features/ai-reading/model/aiReading';

describe('AgentTree', () => {
  it('根节点默认展开、后代默认折叠，并按节点隔离公开事件', async () => {
    const wrapper = mount(AgentTree, { props: { agents: tree(), events: events() } });

    expect(wrapper.get('[data-agent-id="root"]').text()).toContain('主目标');
    expect(wrapper.get('[data-agent-id="child"]').text()).toContain('第一层目标');
    expect(wrapper.find('[data-agent-id="grandchild"]').exists()).toBe(false);
    expect(wrapper.get('[data-agent-id="child"]').text()).not.toContain('根节点公开事件');

    await wrapper.get('[data-agent-toggle="child"]').trigger('click');
    expect(wrapper.get('[data-agent-id="grandchild"]').text()).toContain('第二层目标');
    expect(wrapper.get('[data-agent-id="child"]').text()).toContain('子节点公开事件');
  });

  it('支持键盘可聚焦的折叠按钮和树语义', () => {
    const wrapper = mount(AgentTree, { props: { agents: tree(), events: events() } });
    expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe('Agent 探索树');
    expect(wrapper.get('[data-agent-toggle="root"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-agent-toggle="child"]').attributes('aria-expanded')).toBe('false');
  });

  it('将任务级公开事件放入树内，避免在树外重复展示同一轮探索', () => {
    const wrapper = mount(AgentTree, { props: { agents: tree(), events: [
      ...events(),
      {
        sequence: 3, type: 'task_queued', createdAt: '2026-08-16T00:00:00.000Z',
        agentRunId: null, parentRunId: null,
        payload: { schemaVersion: 2, kind: 'task', title: '任务已进入队列', detail: { status: 'queued' } },
      },
    ] } });

    expect(wrapper.get('[data-task-event="3"]').text()).toContain('任务已进入队列');
  });
});

function tree(): ReadingAgentRun[] {
  return [
    { id: 'root', parentRunId: null, kind: 'root', depth: 0, goal: '主目标', status: 'running' },
    { id: 'child', parentRunId: 'root', kind: 'subagent', depth: 1, goal: '第一层目标', status: 'waiting_children' },
    { id: 'grandchild', parentRunId: 'child', kind: 'subagent', depth: 2, goal: '第二层目标', status: 'completed' },
  ];
}

function events(): ReadingEvent[] {
  return [
    item(1, 'root', '根节点公开事件'),
    item(2, 'child', '子节点公开事件'),
  ];
}

function item(sequence: number, agentRunId: string, title: string): ReadingEvent {
  return {
    sequence, type: 'agent_started', createdAt: '2026-08-16T00:00:00.000Z', agentRunId, parentRunId: null,
    payload: { schemaVersion: 2, kind: 'agent', title, detail: { role: agentRunId === 'root' ? 'root' : 'subagent' } },
  };
}
