import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { installTheme } from './shared/web/theme';

installTheme();

createApp(App).mount('#app');
