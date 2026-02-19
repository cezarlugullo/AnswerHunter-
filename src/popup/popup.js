import { PopupController } from '../controllers/PopupController.js';
import { PopupView } from '../views/PopupView.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize the view (cache DOM elements)
    PopupView.init();

    // Initialize the controller (bind events, load data)
    PopupController.init(PopupView);
});
