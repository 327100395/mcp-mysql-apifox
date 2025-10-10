const dialog = require('dialog-node');

function showConfirmationDialog(callback) {
    dialog.entry("当前任务已处理完成,如有其它任务请回复", '确认', 0, callback);
}

module.exports = {
    showConfirmationDialog
};
