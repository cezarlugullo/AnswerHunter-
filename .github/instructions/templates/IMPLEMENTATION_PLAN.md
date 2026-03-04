# Implementation Plan: [Feature Name]

**Based on Spec**: `.agents/specs/FEATURE_NAME.md`
**Date**: YYYY-MM-DD
**Estimated Total Time**: X hours (Y tasks × ~Z minutes each)
**Status**: ⬜ Not Started / [YELLOW] In Progress / [OK] Complete

---

## Overview

[1-2 frases descrevendo o que será implementado]

**Approach**: [Brief description of chosen approach]

**Key Technical Decisions**:
- Decision 1
- Decision 2

---

## Pre-requisites

- [ ] Spec approved
- [ ] All dependencies installed (`npm install`)
- [ ] Tests baseline is green (`npm test`)
- [ ] Branch created: `feature/xxx`

---

## Tasks

### [PKG] Setup & Dependencies

#### Task 1: Install required packages

**Estimativa**: 2 min
**TDD Phase**: N/A (setup)
**Arquivos**:
- `package.json` (modificar)
- `manifest.json` (modificar - if needed)

**Implementação**:
1. Add npm packages: `npm install package-name`
2. Update manifest permissions if needed
3. Verify installation

**Verificação**:
- [ ] `npm install` runs without errors
- [ ] Extension loads without warnings
- [ ] No conflicts in package-lock.json

---

### [TEST] Phase: Backend API

#### Task 2: Create API route test (RED)

**Estimativa**: 3 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `backend/src/routes/__tests__/xxx.test.js` (criar)

**Implementação**:
```javascript
const request = require('supertest');
const app = require('../../../app');

describe('POST /api/xxx', () => {
  it('should return 200 and data when request is valid', async () => {
    const response = await request(app)
      .post('/api/xxx')
      .send({ param: 'value' });
    
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: expect.any(Object)
    });
  });
});
```

**Verificação**:
- [x] Test fails with clear error message
- [ ] Error is: "Cannot POST /api/xxx" or similar

---

#### Task 3: Create API route (GREEN)

**Estimativa**: 4 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `backend/src/routes/xxx.js` (criar)
- `backend/src/server.js` (modificar)

**Implementação**:
```javascript
// routes/xxx.js
const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { param } = req.body;
    
    // TODO: implement logic
    const result = { processed: param };
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

module.exports = router;
```

```javascript
// server.js (add line)
const xxxRouter = require('./routes/xxx');
app.use('/api/xxx', xxxRouter);
```

**Verificação**:
- [x] Test passes (GREEN)
- [ ] Server starts without errors
- [ ] Manual curl test: `curl -X POST http://localhost:3000/api/xxx -d '{"param":"test"}'`

**Commit**: `feat(backend): add /api/xxx route`

---

#### Task 4: Create service test (RED)

**Estimativa**: 4 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `backend/src/services/__tests__/XxxService.test.js` (criar)

**Implementação**:
```javascript
const XxxService = require('../XxxService');

describe('XxxService', () => {
  describe('processData', () => {
    it('should transform input correctly', () => {
      const input = { raw: 'data' };
      const result = XxxService.processData(input);
      
      expect(result).toEqual({
        processed: 'DATA',
        timestamp: expect.any(Number)
      });
    });
    
    it('should throw on invalid input', () => {
      expect(() => XxxService.processData(null))
        .toThrow('Invalid input');
    });
  });
});
```

**Verificação**:
- [x] Test fails
- [ ] Error is: "XxxService.processData is not a function"

---

#### Task 5: Implement service (GREEN)

**Estimativa**: 5 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `backend/src/services/XxxService.js` (criar)

**Implementação**:
```javascript
class XxxService {
  static processData(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input');
    }
    
    return {
      processed: input.raw.toUpperCase(),
      timestamp: Date.now()
    };
  }
}

module.exports = XxxService;
```

**Verificação**:
- [x] Test passes
- [ ] No linting errors

**Commit**: `feat(backend): add XxxService for data processing`

---

#### Task 6: Integrate service with route

**Estimativa**: 3 min
**TDD Phase**: [REFACTOR] REFACTOR
**Arquivos**:
- `backend/src/routes/xxx.js` (modificar)

**Implementação**:
Replace TODO with actual service call:
```javascript
const XxxService = require('../services/XxxService');

router.post('/', async (req, res) => {
  try {
    const result = XxxService.processData(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});
```

**Verificação**:
- [x] All tests still pass
- [ ] Integration test passes
- [ ] Manual test works

**Commit**: `refactor(backend): integrate XxxService into route`

---

### Phase: Frontend Integration

#### Task 7: Create ApiService method test (RED)

**Estimativa**: 3 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `src/services/__tests__/ApiService.test.js` (modificar)

**Implementação**:
```javascript
describe('ApiService.xxx', () => {
  it('should call backend endpoint with correct data', async () => {
    const mockResponse = { success: true, data: {} };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })
    );
    
    const result = await ApiService.xxx({ param: 'value' });
    
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/xxx',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ param: 'value' })
      })
    );
    expect(result).toEqual(mockResponse.data);
  });
});
```

**Verificação**:
- [x] Test fails
- [ ] Error is: "ApiService.xxx is not a function"

---

#### Task 8: Implement ApiService method (GREEN)

**Estimativa**: 4 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `src/services/ApiService.js` (modificar)

**Implementação**:
```javascript
class ApiService {
  static async xxx(params) {
    const response = await fetch(`${this.baseUrl}/api/xxx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result = await response.json();
    return result.data;
  }
}
```

**Verificação**:
- [x] Test passes
- [ ] No console errors

**Commit**: `feat(frontend): add ApiService.xxx method`

---

#### Task 9: Create controller method test (RED)

**Estimativa**: 4 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `src/controllers/__tests__/PopupController.test.js` (modificar)

**Implementação**:
```javascript
describe('PopupController.handleXxx', () => {
  let controller;
  
  beforeEach(() => {
    controller = new PopupController(mockView, mockModel);
  });
  
  it('should call ApiService and update view', async () => {
    const mockData = { processed: 'DATA' };
    ApiService.xxx = jest.fn().mockResolvedValue(mockData);
    
    await controller.handleXxx('input');
    
    expect(ApiService.xxx).toHaveBeenCalledWith({ param: 'input' });
    expect(mockView.displayResult).toHaveBeenCalledWith(mockData);
  });
  
  it('should show error on API failure', async () => {
    ApiService.xxx = jest.fn().mockRejectedValue(new Error('API error'));
    
    await controller.handleXxx('input');
    
    expect(mockView.showError).toHaveBeenCalledWith('API error');
  });
});
```

**Verificação**:
- [x] Test fails
- [ ] Error shows handleXxx doesn't exist

---

#### Task 10: Implement controller method (GREEN)

**Estimativa**: 5 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `src/controllers/PopupController.js` (modificar)

**Implementação**:
```javascript
class PopupController {
  async handleXxx(input) {
    try {
      this.view.showLoading();
      
      const result = await ApiService.xxx({ param: input });
      
      this.view.displayResult(result);
      this.view.hideLoading();
    } catch (error) {
      this.view.hideLoading();
      this.view.showError(error.message);
      console.error('Error in handleXxx:', error);
    }
  }
}
```

**Verificação**:
- [x] Test passes
- [ ] All existing tests still pass

**Commit**: `feat(controller): add handleXxx method`

---

### Phase: UI Implementation

#### Task 11: Create view method test (RED)

**Estimativa**: 3 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `src/views/__tests__/PopupView.test.js` (modificar)

**Implementação**:
```javascript
describe('PopupView.displayResult', () => {
  let view, container;
  
  beforeEach(() => {
    container = document.createElement('div');
    view = new PopupView(container);
    view.render();
  });
  
  it('should display result in results container', () => {
    const result = { processed: 'DATA' };
    
    view.displayResult(result);
    
    const resultsDiv = container.querySelector('.results');
    expect(resultsDiv.textContent).toContain('DATA');
    expect(resultsDiv.classList.contains('visible')).toBe(true);
  });
});
```

**Verificação**:
- [x] Test fails
- [ ] displayResult is undefined or doesn't work

---

#### Task 12: Implement view method (GREEN)

**Estimativa**: 4 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `src/views/PopupView.js` (modificar)
- `src/popup/popup.html` (modificar)

**Implementação**:
```javascript
// PopupView.js
class PopupView {
  displayResult(result) {
    const resultsDiv = this.container.querySelector('.results');
    resultsDiv.innerHTML =`
      <div class="result-item">
        <strong>Result:</strong> ${result.processed}
      </div>
    `;
    resultsDiv.classList.add('visible');
  }
}
```

```html
<!-- popup.html (add if not exists) -->
<div class="results" style="display: none;"></div>
```

**Verificação**:
- [x] Test passes
- [ ] Manual test in extension popup works

**Commit**: `feat(view): add displayResult method`

---

#### Task 13: Add CSS styling

**Estimativa**: 2 min
**TDD Phase**: N/A (visual)
**Arquivos**:
- `src/popup/popup.css` (modificar)

**Implementação**:
```css
.results {
  margin-top: 16px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
  display: none;
}

.results.visible {
  display: block;
}

.result-item {
  font-size: 14px;
  line-height: 1.5;
}

.result-item strong {
  color: #333;
}
```

**Verificação**:
- [ ] UI looks good in popup
- [ ] Responsive on different sizes
- [ ] Matches design spec

**Commit**: `style(popup): add results display styling`

---

#### Task 14: Wire up UI events

**Estimativa**: 3 min
**TDD Phase**: Integration
**Arquivos**:
- `src/popup/popup.js` (modificar)

**Implementação**:
```javascript
// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('#app');
  const view = new PopupView(container);
  const model = new SettingsModel();
  const controller = new PopupController(view, model);
  
  // Wire up new feature button
  const xxxButton = document.getElementById('xxx-button');
  const xxxInput = document.getElementById('xxx-input');
  
  xxxButton.addEventListener('click', () => {
    const value = xxxInput.value;
    controller.handleXxx(value);
  });
});
```

**Verificação**:
- [ ] Button click triggers handler
- [ ] Input value is passed correctly
- [ ] Results display properly
- [ ] No console errors

**Commit**: `feat(popup): wire up xxx feature UI`

---

### [NOTE] Phase: Edge Cases & Polish

#### Task 15: Add loading states test

**Estimativa**: 3 min
**TDD Phase**: [RED] RED
**Arquivos**:
- `src/views/__tests__/PopupView.test.js` (modificar)

**Implementação**:
```javascript
it('should show loading spinner', () => {
  view.showLoading();
  
  const spinner = container.querySelector('.spinner');
  expect(spinner.classList.contains('visible')).toBe(true);
});

it('should hide loading spinner', () => {
  view.showLoading();
  view.hideLoading();
  
  const spinner = container.querySelector('.spinner');
  expect(spinner.classList.contains('visible')).toBe(false);
});
```

**Verificação**:
- [x] Tests fail (methods don't exist)

---

#### Task 16: Implement loading states (GREEN)

**Estimativa**: 3 min
**TDD Phase**: [GREEN] GREEN
**Arquivos**:
- `src/views/PopupView.js` (modificar)
- `src/popup/popup.html` (modificar)

**Implementação**:
```javascript
showLoading() {
  const spinner = this.container.querySelector('.spinner');
  spinner.classList.add('visible');
}

hideLoading() {
  const spinner = this.container.querySelector('.spinner');
  spinner.classList.remove('visible');
}
```

**Verificação**:
- [x] Tests pass
- [ ] Spinner shows/hides correctly in UI

**Commit**: `feat(view): add loading states`

---

#### Task 17: Add error handling tests

**Estimativa**: 4 min
**TDD Phase**: [RED] RED → [GREEN] GREEN
**Arquivos**:
- Various test files (add error cases to existing tests)

**Implementação**:
Add error cases to backend, service, controller tests:
```javascript
it('should handle network timeout', async () => {
  // test implementation
});

it('should handle invalid input', () => {
  // test implementation
});

it('should handle empty response', async () => {
  // test implementation
});
```

**Verificação**:
- [x] Error tests pass
- [ ] Error messages are user-friendly
- [ ] No unhandled promise rejections

**Commit**: `test: add comprehensive error handling tests`

---

#### Task 18: Add input validation

**Estimativa**: 3 min
**TDD Phase**: [REFACTOR] REFACTOR
**Arquivos**:
- Backend route, frontend controller (add validation)

**Implementação**:
```javascript
// Backend validation
if (!param || typeof param !== 'string' || param.trim() === '') {
  return res.status(400).json({
    success: false,
    error: { message: 'Param must be non-empty string' }
  });
}

// Frontend validation
if (!input || input.trim().length === 0) {
  this.view.showError('Please enter a valid value');
  return;
}
```

**Verificação**:
- [x] Validation tests pass
- [ ] UI shows helpful messages
- [ ] Backend returns proper status codes

**Commit**: `refactor: add input validation`

---

### [STUDY] Phase: Documentation

#### Task 19: Add JSDoc comments

**Estimativa**: 3 min
**TDD Phase**: N/A
**Arquivos**:
- All new files (add JSDoc)

**Implementação**:
```javascript
/**
 * Processes input data and returns transformed result
 * @param {Object} input - Raw input data
 * @param {string} input.param - Parameter to process
 * @returns {Promise<Object>} Processed result
 * @throws {Error} If input is invalid
 */
static async processData(input) {
  // ...
}
```

**Verificação**:
- [ ] All public methods documented
- [ ] Parameters and returns described
- [ ] Exceptions documented

**Commit**: `docs: add JSDoc to new methods`

---

#### Task 20: Update README

**Estimativa**: 2 min
**TDD Phase**: N/A
**Arquivos**:
- `README.md` (adicionar seção)

**Implementação**:
Add section describing new feature:
```markdown
### Xxx Feature

This feature allows users to [description].

**Usage**:
1. Step 1
2. Step 2

**API**: `POST /api/xxx`
```

**Verificação**:
- [ ] README is clear and accurate
- [ ] Examples are correct

**Commit**: `docs: add xxx feature to README`

---

## Summary

**Total Tasks**: 20
**Estimated Time**: ~65 minutes

**Phases**:
- Setup: 1 task (2 min)
- Backend: 5 tasks (19 min)
- Frontend: 4 tasks (16 min)
- UI: 4 tasks (12 min)
- Polish: 4 tasks (13 min)
- Docs: 2 tasks (5 min)

**Test Coverage**:
- Unit tests: 12 tasks
- Integration tests: 3 tasks
- Manual tests: All tasks

---

## Execution Notes

### As you work:
1. Check off items as completed
2. Note any deviations from plan
3. Update time estimates if significantly off
4. Document blockers immediately

### After completion:
- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Manual testing complete
- [ ] Code review done (self-review skill)
- [ ] Documentation updated
- [ ] Ready for merge

---

## Deviations / Notes

[Document any changes to the plan or unexpected issues]

---

**Next Step**: Start with Task 1 and work through sequentially
