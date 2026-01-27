import { PopupController } from '../controllers/PopupController.js';
import { PopupView } from '../views/PopupView.js';

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa View (cache DOM elements)
    PopupView.init();

    // Inicializa Controller (bind events, load data)
    PopupController.init(PopupView);
});
