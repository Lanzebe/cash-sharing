from collections import defaultdict


class Transaction:
    def __init__(self, description, paid_by, split_percent, total_amount, tag, tid=None):
        self.id = tid
        self.description = description
        self.total_amount = float(total_amount)
        self.tag = tag

        if isinstance(paid_by, str):
            self.paid_by = {paid_by: self.total_amount}
        elif isinstance(paid_by, dict):
            self.paid_by = {p: float(a) for p, a in paid_by.items()}
        else:
            raise ValueError("paid_by must be string or dict")

        self.split_percent = {p: float(pct) for p, pct in split_percent.items()}
        self.split_amounts = {
            p: (pct / 100.0) * self.total_amount
            for p, pct in self.split_percent.items()
        }


class ExpenseManager:
    def __init__(self, transactions=None):
        self.transactions = transactions if transactions is not None else []

    def add_transaction(self, transaction):
        self.transactions.append(transaction)

    def balances(self):
        bal = defaultdict(float)
        for t in self.transactions:
            for person, paid in t.paid_by.items():
                bal[person] += paid
            for person, owes in t.split_amounts.items():
                bal[person] -= owes
        return {p: round(a, 2) for p, a in bal.items()}

    def settle_debts(self):
        bal = self.balances()
        creditors = [[p, a] for p, a in bal.items() if round(a, 2) > 0]
        debtors = [[p, -a] for p, a in bal.items() if round(a, 2) < 0]
        creditors.sort(key=lambda x: x[1], reverse=True)
        debtors.sort(key=lambda x: x[1], reverse=True)

        settlements = []
        i = j = 0
        while i < len(debtors) and j < len(creditors):
            debtor, debt_amt = debtors[i]
            creditor, cred_amt = creditors[j]
            payment = min(debt_amt, cred_amt)
            settlements.append({
                "debtor": debtor,
                "creditor": creditor,
                "amount": round(payment, 2),
            })
            debtors[i][1] -= payment
            creditors[j][1] -= payment
            if debtors[i][1] == 0:
                i += 1
            if creditors[j][1] == 0:
                j += 1
        return settlements

    def tag_summary(self):
        tags = defaultdict(float)
        for t in self.transactions:
            tags[t.tag] += t.total_amount
        return {tag: round(total, 2) for tag, total in sorted(tags.items(), key=lambda x: x[1], reverse=True)}

    def total_spend(self):
        return round(sum(t.total_amount for t in self.transactions), 2)


def to_dict(t):
    return {
        "id": t.id,
        "description": t.description,
        "total_amount": t.total_amount,
        "paid_by": t.paid_by,
        "split_percent": t.split_percent,
        "split_amounts": t.split_amounts,
        "tag": t.tag,
    }


def from_dict(d):
    return Transaction(
        tid=d["id"],
        description=d["description"],
        total_amount=d["total_amount"],
        paid_by=d["paid_by"],
        split_percent=d["split_percent"],
        tag=d["tag"],
    )