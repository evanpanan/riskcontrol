import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {utils,workbookBuffer} from '../src/lib/excelExport';
async function main(){
 const book=utils.book_new();
 const sheet=utils.json_to_sheet([{姓名:'=SUM(A1:A2)',金额:12345.67}],{header:['姓名','金额']});sheet['!cols']=[{wch:20},{wch:18}];utils.book_append_sheet(book,sheet,'客户档案');utils.book_append_sheet(book,utils.json_to_sheet([{状态:'已结算'}]),'结算记录');
 const restored=new ExcelJS.Workbook();await restored.xlsx.load(await workbookBuffer(book));
 assert.equal(restored.worksheets.length,2);assert.equal(restored.getWorksheet('客户档案')!.getCell('B2').value,12345.67);assert.equal(restored.getWorksheet('客户档案')!.getCell('A2').value,'=SUM(A1:A2)');assert.equal(restored.getWorksheet('结算记录')!.getCell('A2').value,'已结算');
 console.log('PASS Excel export preserves two sheets, Chinese headers, decimal amount and literal user text without formula execution');
}
main().catch(e=>{console.error(e);process.exitCode=1});
