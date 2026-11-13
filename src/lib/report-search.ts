import type {SeparationCustomer} from "./reports-server";
import {matchesShipmentItem} from "./shipment-item-search";

/** Filtra somente os itens visíveis; busca por cliente mantém seu grupo inteiro. */
export function filterReportCustomers<T extends SeparationCustomer>(customers:T[], query:string):T[]{
  if(!query.trim())return customers;
  return customers.map(customer=>{
    if(matchesShipmentItem(`${customer.name??""} ${customer.phone_e164}`,query))return customer;
    return {...customer,
      lots:customer.lots.filter(lot=>matchesShipmentItem([lot.code,lot.title,lot.description,lot.notes,...lot.movedItems,...(lot.searchItems??[])].filter(Boolean).join(" "),query)),
      logisticsPending:(customer.logisticsPending??[]).filter(issue=>matchesShipmentItem(`${issue.code} ${issue.title} ${issue.reason}`,query)),
      storeOrders:(customer.storeOrders??[]).filter(order=>matchesShipmentItem(`${order.code} ${order.items.map(item=>item.name).join(" ")}`,query)),
    };
  }).filter(customer=>customer.lots.length || customer.logisticsPending?.length || customer.storeOrders?.length) as T[];
}
