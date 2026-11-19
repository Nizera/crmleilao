import {getAdminVoucherSummary} from "@/lib/admin-collection-reports-server";
import {VoucherSummary,CollectionReportError} from "@/components/admin/collection-report-ui";
export async function AuctionVouchersCard(){
 const data = await getAdminVoucherSummary().catch(() => null);
 return data ? <VoucherSummary data={data} compact/> : <CollectionReportError href="/admin/vouchers-leilao"/>;
}
