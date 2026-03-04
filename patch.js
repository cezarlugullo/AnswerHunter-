const fs = require('fs');
const file = 'src/controllers/PopupController.js';
let data = fs.readFileSync(file, 'utf8');

data = data.replace(
  'setTimeout(() => this._showToolkitTour(), 900);',
  'setTimeout(() => this._showFloatingTour(), 400);'
);

const regex = /\/\*\*(?:\s*\*\s*.*?)*\s*\*\/\s*_showToolkitTour\(\) \{[\s\S]*?const newFinishBtn = document\.getElementById\('ttFinishBtn'\);\s*\}/gm;

const newBlock = \_showFloatingTour() {
    const tourWrapper = document.getElementById('tk-floating-tour');
    const popover = document.getElementById('tk-popover');
    const content = document.getElementById('tk-content');
    const stepCount = document.getElementById('tk-step-count');
    const closeBtn = document.getElementById('tk-close');
    const nextBtn = document.getElementById('tk-next-btn');
    if (!tourWrapper || !popover) return;
    
    this.view.switchTab('search');

    const steps = [
      {
        target: '#extractBtn',
        placement: 'bottom',
        title: 'Extrair (Baixar) Questões',
        desc: 'Com uma aba aberta na sua plataforma de estudos, clique aqui para extrair as questões e resolver com IA.',
        icon: 'touch_app'
      },
      {
        target: '.tab-btn[data-tab="binder"]',
        placement: 'bottom',
        title: 'Binder',
        desc: 'Suas questões ficarão salvas aqui. Vamos acessar a aba.',
        icon: 'folder'
      },
      {
        target: '#importBinderBtn',
        placement: 'bottom',
        title: 'Carregar Questões',
        desc: 'No Binder, use este botão para importar (carregar) arquivos de backup de forma fácil.',
        icon: 'upload_file',
        beforeShow: () => this.view.switchTab('binder')
      },
      {
        target: '#openStudyHeaderBtn',
        placement: 'bottom',
        title: 'Ir para o Study Hub',
        desc: 'Por fim, clique no ícone \<span style="font-family:monospace">Local Library</span>\ do cabeçalho para focar e revisar as questões salvas. Bom estudo!',
        icon: 'local_library'
      }
    ];

    let current = 0;
    let oldHighlight = null;

    const endTour = async () => {
      if (oldHighlight) oldHighlight.classList.remove('tk-target-highlight');
      tourWrapper.classList.add('hidden');
      popover.classList.remove('tk-show');
      this.onboardingFlags.toolkitTourShown = true;
      await this.saveOnboardingFlags();
      this.view.switchTab('search');
    };

    const renderStep = () => {
        if (oldHighlight) {
            oldHighlight.classList.remove('tk-target-highlight');
        }

        if (current >= steps.length) {
            endTour();
            return;
        }

        const step = steps[current];
        if (step.beforeShow) step.beforeShow();

        setTimeout(() => {
            const targetEl = document.querySelector(step.target);
            if (!targetEl) {
                current++;
                renderStep();
                return;
            }

            popover.dataset.placement = step.placement;
            oldHighlight = targetEl;
            targetEl.classList.add('tk-target-highlight');

            content.innerHTML = '<div class="tk-title"><span class="material-symbols-rounded">' + step.icon + '</span> ' + step.title + '</div><div class="tk-desc">' + step.desc + '</div>';
            stepCount.textContent = (current + 1) + '/' + steps.length;
            nextBtn.textContent = current === steps.length - 1 ? 'Começar!' : 'Próximo';

            tourWrapper.classList.remove('hidden');

            const rect = targetEl.getBoundingClientRect();
            if (step.placement === 'bottom') {
                popover.style.top = (rect.bottom + 12) + 'px';
                let left = rect.left + (rect.width / 2) - 130;
                if (left < 10) left = 10;
                if (left + 260 > window.innerWidth - 10) left = window.innerWidth - 270;
                popover.style.left = left + 'px';
            }

            requestAnimationFrame(() => popover.classList.add('tk-show'));
        }, 50); 
    };

    const nextHandler = () => {
        popover.classList.remove('tk-show');
        setTimeout(() => {
            current++;
            renderStep();
        }, 200);
    };

    const newNext = nextBtn.cloneNode(true);
    nextBtn.replaceWith(newNext);
    newNext.addEventListener('click', nextHandler);

    const newClose = closeBtn.cloneNode(true);
    closeBtn.replaceWith(newClose);
    newClose.addEventListener('click', endTour);

    renderStep();
}\;

data = data.replace(regex, newBlock);
fs.writeFileSync(file, data, 'utf8');
console.log('Replaced successfully');
